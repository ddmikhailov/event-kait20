import os
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import (
    UnsafeTestDatabaseConfiguration,
    _require_disposable_test_database_name,
    _require_external_test_database_is_safe,
)

TESTS_DIR = Path(__file__).parent

# --- naming token check (defense-in-depth, not the primary guard) ---------


def test_accepts_a_database_name_ending_in_test_token() -> None:
    assert (
        _require_disposable_test_database_name(
            "mysql://root@127.0.0.1:3306/event_registration_test"
        )
        == "event_registration_test"
    )


@pytest.mark.parametrize(
    "database_name",
    ["test_event_registration", "event-test-ci", "event_test_42"],
)
def test_accepts_other_token_boundary_forms(database_name: str) -> None:
    url = f"mysql://root@127.0.0.1:3306/{database_name}"
    assert _require_disposable_test_database_name(url) == database_name


def test_accepts_test_regardless_of_case() -> None:
    assert (
        _require_disposable_test_database_name(
            "mysql://root@127.0.0.1:3306/Event_Registration_TEST"
        )
        == "Event_Registration_TEST"
    )


@pytest.mark.parametrize(
    "database_name",
    ["latest_db", "contest_archive", "attestation_records"],
)
def test_rejects_test_embedded_in_another_word(database_name: str) -> None:
    url = f"mysql://root@127.0.0.1:3306/{database_name}"
    with pytest.raises(UnsafeTestDatabaseConfiguration, match="own word"):
        _require_disposable_test_database_name(url)


def test_rejects_a_database_name_without_test() -> None:
    with pytest.raises(
        UnsafeTestDatabaseConfiguration, match="event_registration_production"
    ):
        _require_disposable_test_database_name(
            "mysql://root@127.0.0.1:3306/event_registration_production"
        )


def test_rejects_a_url_with_no_database_name() -> None:
    with pytest.raises(UnsafeTestDatabaseConfiguration, match="TEST_DATABASE_URL"):
        _require_disposable_test_database_name("mysql://root@127.0.0.1:3306/")


# --- external database safety: naming + confirmation + collision ---------

_TEST_URL = "mysql://root:rootpw@127.0.0.1:3306/event_registration_test"


def test_a_correct_name_and_exact_confirmation_is_accepted() -> None:
    _require_external_test_database_is_safe(
        {
            "TEST_DATABASE_URL": _TEST_URL,
            "TEST_DATABASE_CONFIRM_RESET": "event_registration_test",
        }
    )  # does not raise


def test_b_correct_test_like_name_without_confirmation_is_rejected() -> None:
    with pytest.raises(UnsafeTestDatabaseConfiguration, match="CONFIRM_RESET"):
        _require_external_test_database_is_safe({"TEST_DATABASE_URL": _TEST_URL})


def test_c_correct_name_with_wrong_confirmation_is_rejected() -> None:
    with pytest.raises(UnsafeTestDatabaseConfiguration, match="CONFIRM_RESET"):
        _require_external_test_database_is_safe(
            {
                "TEST_DATABASE_URL": _TEST_URL,
                "TEST_DATABASE_CONFIRM_RESET": "event_registration_tests",
            }
        )


def test_d_production_like_name_is_rejected_even_with_matching_confirmation() -> None:
    url = "mysql://root:rootpw@127.0.0.1:3306/event_registration_production"
    with pytest.raises(UnsafeTestDatabaseConfiguration, match="own word"):
        _require_external_test_database_is_safe(
            {
                "TEST_DATABASE_URL": url,
                "TEST_DATABASE_CONFIRM_RESET": "event_registration_production",
            }
        )


def test_e_same_target_as_application_database_is_rejected_despite_confirmation() -> (
    None
):
    with pytest.raises(UnsafeTestDatabaseConfiguration, match="DATABASE_URL"):
        _require_external_test_database_is_safe(
            {
                "DATABASE_URL": (
                    "mysql://event_app:CHANGE_ME@127.0.0.1/event_registration_test"
                ),
                "TEST_DATABASE_URL": _TEST_URL,
                "TEST_DATABASE_CONFIRM_RESET": "event_registration_test",
            }
        )


def test_e_collision_ignores_credentials_and_default_port() -> None:
    # Same host+port+database as DATABASE_URL, different user/password and an
    # implicit vs. explicit default port — must still be recognised as the
    # same target.
    with pytest.raises(UnsafeTestDatabaseConfiguration, match="DATABASE_URL"):
        _require_external_test_database_is_safe(
            {
                "DATABASE_URL": (
                    "mysql://event_app:CHANGE_ME@127.0.0.1/event_registration_test"
                ),
                "TEST_DATABASE_URL": (
                    "mysql://root:different-password@127.0.0.1:3306/"
                    "event_registration_test"
                ),
                "TEST_DATABASE_CONFIRM_RESET": "event_registration_test",
            }
        )


def test_f_self_managed_branch_does_not_require_confirmation() -> None:
    _require_external_test_database_is_safe({})  # does not raise
    _require_external_test_database_is_safe(
        {"DATABASE_URL": "mysql://event_app:CHANGE_ME@127.0.0.1/event_registration"}
    )  # does not raise


def test_g_database_url_without_a_database_name_is_rejected() -> None:
    with pytest.raises(UnsafeTestDatabaseConfiguration):
        _require_external_test_database_is_safe(
            {
                "TEST_DATABASE_URL": "mysql://root@127.0.0.1:3306/",
                "TEST_DATABASE_CONFIRM_RESET": "",
            }
        )


def test_h_error_text_never_contains_the_password() -> None:
    secret = "SuperSecretPW123"  # noqa: S105 - fixture literal, not a real credential
    url = f"mysql://root:{secret}@127.0.0.1:3306/event_registration_production"

    with pytest.raises(UnsafeTestDatabaseConfiguration) as naming_error:
        _require_external_test_database_is_safe({"TEST_DATABASE_URL": url})
    assert secret not in str(naming_error.value)

    with pytest.raises(UnsafeTestDatabaseConfiguration) as collision_error:
        _require_external_test_database_is_safe(
            {
                "DATABASE_URL": (
                    f"mysql://event_app:{secret}@127.0.0.1/event_registration_test"
                ),
                "TEST_DATABASE_URL": (
                    f"mysql://root:{secret}@127.0.0.1:3306/event_registration_test"
                ),
                "TEST_DATABASE_CONFIRM_RESET": "event_registration_test",
            }
        )
    assert secret not in str(collision_error.value)


# --- session-level integration: the whole run aborts, not just one fixture -


def test_unsafe_external_database_aborts_the_whole_session_before_collection() -> None:
    """pytest_configure must stop the run for tests that never touch the
    database_url/client fixtures at all — proving the guard is a session-wide
    gate, not something only DB-dependent tests would hit. Runs a real pytest
    subprocess with --collect-only (no MySQL is ever contacted) against a file
    with no database dependency."""
    child_env = dict(os.environ)
    child_env.pop("TEST_DATABASE_CONFIRM_RESET", None)
    child_env.pop("DATABASE_URL", None)
    child_env["TEST_DATABASE_URL"] = (
        "mysql://root@127.0.0.1:3306/event_registration_production"
    )
    result = subprocess.run(  # noqa: S603 - fixed argv, no shell, test-only
        [
            sys.executable,
            "-m",
            "pytest",
            "--collect-only",
            "-q",
            "test_config_loading.py",
        ],
        cwd=TESTS_DIR,
        env=child_env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "event_registration_production" in output
    assert "own word" in output
