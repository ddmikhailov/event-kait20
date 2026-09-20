from __future__ import annotations

import asyncio
import json
import logging
import struct
import zipfile
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import Request, UploadFile
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import text
from starlette.datastructures import Headers

from event_api.config import Settings
from event_api.database import Database
from event_api.errors import ApiError, unexpected_error_handler
from event_api.routers.excel import (
    MAX_ARCHIVE_ENTRIES,
    MAX_COMPRESSION_RATIO,
    MAX_FILE,
    MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES,
    MAX_TOTAL_UNCOMPRESSED_BYTES,
    XLSX_MIME,
    _parse,
    _preflight_declared_entry_count,
    _validate_upload,
    _validate_xlsx_archive,
)
from event_api.security import (
    auth_link_token,
    hash_password,
    registration_qr,
    token_hash,
    verify_auth_link,
    verify_registration,
)


def test_signed_links_are_bound_to_purpose_and_reject_tampering() -> None:
    record_id = str(uuid4())
    expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=15)
    secret = "a" * 43
    invitation = auth_link_token("invitation", record_id, expires_at, secret)
    stored_hash = token_hash(invitation)

    assert verify_auth_link(
        invitation, "invitation", record_id, expires_at, stored_hash, secret
    )
    assert not verify_auth_link(
        invitation, "password-reset", record_id, expires_at, stored_hash, secret
    )
    assert not verify_auth_link(
        f"{invitation}x", "invitation", record_id, expires_at, stored_hash, secret
    )


def test_registration_qr_contains_no_participant_data_and_rejects_tampering() -> None:
    public_id = str(uuid4())
    secret = "q" * 43
    payload = registration_qr(public_id, secret)
    identifier, signature = payload.split(".", maxsplit=1)

    assert identifier == public_id
    assert "participant@example.org" not in payload
    assert "+79991234567" not in payload
    assert verify_registration(public_id, signature, secret)
    assert not verify_registration(public_id, f"{signature}x", secret)
    assert not verify_registration(str(uuid4()), signature, secret)


def test_excel_rejects_wrong_extension_mime_and_oversized_content() -> None:
    for filename, content_type in [
        ("participants.xlsm", XLSX_MIME),
        ("participants.xlsx", "application/octet-stream"),
        ("participants.xlsx.exe", XLSX_MIME),
    ]:
        upload = UploadFile(
            file=BytesIO(b"PK"),
            filename=filename,
            headers=Headers({"content-type": content_type}),
        )
        with pytest.raises(ApiError, match="Only an XLSX"):
            _validate_upload(upload)
    with pytest.raises(ApiError, match="up to 5 MiB"):
        _parse(b"PK" + b"0" * MAX_FILE)


def _crafted_zip(
    entries: list[tuple[str, int, int, int]],
    declared_entries: int | None = None,
) -> bytes:
    """Hand-build a minimal ZIP whose central directory *declares* whatever
    compressed/uncompressed sizes and flag bits the caller asks for, backed by
    a single throwaway byte of real payload per entry.

    `zipfile.ZipFile.infolist()` reads sizes straight from the central
    directory without decompressing or cross-checking them against the actual
    (tiny) payload, which is exactly what `_validate_xlsx_archive` relies on
    to reject before a real parser ever inflates anything — so this is enough
    to exercise every limit without writing a single real oversized file.

    `entries`: list of (filename, declared_compress_size, declared_file_size,
    flag_bits). `declared_entries` overrides the EOCD's own entry count,
    independent of how many real central directory records `entries` actually
    produces — the only way to build an archive where the EOCD lies about the
    count, which is exactly what `_preflight_declared_entry_count`'s
    actual-vs-declared comparison exists to catch.
    """
    local_records = BytesIO()
    central_records = BytesIO()
    offset = 0
    for name, compress_size, file_size, flag_bits in entries:
        name_bytes = name.encode()
        payload = b"x"
        local_header = (
            struct.pack(
                "<IHHHHHIIIHH",
                0x04034B50,
                20,
                flag_bits,
                0,
                0,
                0,
                0,
                compress_size,
                file_size,
                len(name_bytes),
                0,
            )
            + name_bytes
            + payload
        )
        central_records.write(
            struct.pack(
                "<IHHHHHHIIIHHHHHII",
                0x02014B50,
                20,
                20,
                flag_bits,
                0,
                0,
                0,
                0,
                compress_size,
                file_size,
                len(name_bytes),
                0,
                0,
                0,
                0,
                0,
                offset,
            )
            + name_bytes
        )
        local_records.write(local_header)
        offset += len(local_header)
    central_bytes = central_records.getvalue()
    reported = len(entries) if declared_entries is None else declared_entries
    end_of_central_directory = struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        reported,
        reported,
        len(central_bytes),
        offset,
        0,
    )
    return local_records.getvalue() + central_bytes + end_of_central_directory


def _normal_workbook_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(["Фамилия", "Имя", "Дата рождения", "Тип участника", "Телефон"])
    sheet.append(["Иванов", "Пётр", "2001-05-06", "KAIT_STUDENT", "+79990000002"])
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _splice_worksheet_xml(source: bytes, malicious_sheet_xml: bytes) -> bytes:
    """Return a real, normally-DEFLATEd XLSX with `xl/worksheets/sheet1.xml`
    replaced by `malicious_sheet_xml`, every other part copied verbatim.

    Unlike `_crafted_zip`, this goes through real `zipfile` compression, so
    the result has entirely ordinary declared sizes/ratios — an XML-entity
    attack lives inside a tiny, unremarkable XML part, not in the ZIP
    metadata `_validate_xlsx_archive` inspects, so it must reach the XML
    parser itself to be tested.
    """
    original = zipfile.ZipFile(BytesIO(source))
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as rebuilt:
        for item in original.infolist():
            payload = original.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                payload = malicious_sheet_xml
            rebuilt.writestr(item.filename, payload)
    return output.getvalue()


def test_a_normal_project_xlsx_is_accepted() -> None:
    source = _normal_workbook_bytes()
    assert _preflight_declared_entry_count(source) == 9
    _validate_xlsx_archive(source)  # does not raise
    headers, _mapping, parsed = _parse(source)
    assert "Фамилия" in headers
    assert parsed[0]["participant"]["lastName"] == "Иванов"


def test_a_entry_count_bomb_is_rejected_before_zipfile_is_ever_constructed() -> None:
    """The key acceptance test for this round: `zipfile.ZipFile` must never be
    asked to materialize a `ZipInfo` per entry for a member-count bomb —
    rejection has to come from the raw central-directory walk alone, and it
    must trigger even when the EOCD itself lies about a low count."""
    malicious = _crafted_zip(
        [(f"part{i}.xml", 1, 1, 0) for i in range(MAX_ARCHIVE_ENTRIES + 1)],
        declared_entries=1,  # the bypass this round closes: EOCD says 1
    )
    with (
        patch("event_api.routers.excel.zipfile.ZipFile") as mocked_zip_file,
        patch("event_api.routers.excel.load_workbook") as mocked_load_workbook,
        pytest.raises(ApiError, match="safe size limits"),
    ):
        _parse(malicious)
    mocked_zip_file.assert_not_called()
    mocked_load_workbook.assert_not_called()


def test_a_eocd_entry_count_alone_is_not_trusted_even_below_the_cap() -> None:
    # EOCD declares 1 entry; the central directory actually, honestly
    # contains 2 well-formed records. Both numbers are individually under
    # MAX_ARCHIVE_ENTRIES, so this can only be caught by actually counting
    # real records and comparing against what the EOCD claimed.
    mismatched = _crafted_zip(
        [("a.xml", 1, 1, 0), ("b.xml", 1, 1, 0)],
        declared_entries=1,
    )
    with (
        patch("event_api.routers.excel.zipfile.ZipFile") as mocked_zip_file,
        pytest.raises(ApiError, match="could not be read"),
    ):
        _preflight_declared_entry_count(mismatched)
    mocked_zip_file.assert_not_called()


def _eocd_tail(cd_offset: int, cd_size: int, declared_entries: int) -> bytes:
    return struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        declared_entries,
        declared_entries,
        cd_size,
        cd_offset,
        0,
    )


def test_central_directory_record_declaring_more_bytes_than_available_is_rejected() -> (
    None
):
    # filename_length claims 9000 bytes of name, but the declared cd_size
    # only covers the 46-byte fixed header itself — must fail closed, not
    # raise IndexError/struct.error out of the walker.
    local_area = b"\x00" * 10
    fake_record = struct.pack(
        "<IHHHHHHIIIHHHHHII",
        0x02014B50,
        20,
        20,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        9000,  # filename_length: a lie
        0,
        0,
        0,
        0,
        0,
        0,
    )
    body = local_area + fake_record
    source = body + _eocd_tail(len(local_area), len(fake_record), 1)
    with pytest.raises(ApiError, match="could not be read"):
        _preflight_declared_entry_count(source)


def test_central_directory_record_with_wrong_signature_is_rejected() -> None:
    local_area = b"\x00" * 10
    fake_record = b"NOPE" + b"\x00" * 42  # 46 bytes, not a PK\x01\x02 signature
    body = local_area + fake_record
    source = body + _eocd_tail(len(local_area), len(fake_record), 1)
    with pytest.raises(ApiError, match="could not be read"):
        _preflight_declared_entry_count(source)


def test_b_truncated_or_missing_eocd_is_a_controlled_validation_error() -> None:
    for broken in (
        b"",
        b"PK\x03\x04",  # shorter than a bare EOCD record
        b"not a zip file at all, no signature anywhere" * 3,
        _crafted_zip([("sheet1.xml", 10, 10, 0)])[:-5],  # EOCD cut short
    ):
        with pytest.raises(ApiError, match="could not be read"):
            _preflight_declared_entry_count(broken)


def test_b_eocd_signature_inside_payload_is_not_mistaken_for_a_real_record() -> None:
    # A `PK\x05\x06` byte sequence appears once, but the two bytes right after
    # it (read as a declared comment length) don't make the record end at
    # EOF, and there is no other, later signature occurrence — so this must
    # be rejected as "no valid EOCD found" rather than trusting the decoy.
    decoy_only = b"leading garbage " + b"PK\x05\x06" + b"tail bytes, not a real record"
    with pytest.raises(ApiError, match="could not be read"):
        _preflight_declared_entry_count(decoy_only)


def test_b_zip64_sentinel_values_fail_closed() -> None:
    # A classic EOCD reporting the ZIP64 escape value for total entries.
    sentinel_entries = 0xFFFF
    local_records = BytesIO()
    name = b"sheet1.xml"
    local_records.write(
        struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, 0, 0, 0, 0, 0, 1, 1, len(name), 0)
        + name
        + b"x"
    )
    central = (
        struct.pack(
            "<IHHHHHHIIIHHHHHII",
            0x02014B50,
            20,
            20,
            0,
            0,
            0,
            0,
            0,
            1,
            1,
            len(name),
            0,
            0,
            0,
            0,
            0,
            0,
        )
        + name
    )
    body = local_records.getvalue()
    eocd = struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        sentinel_entries,
        sentinel_entries,
        len(central),
        len(body),
        0,
    )
    with pytest.raises(ApiError, match="could not be read"):
        _preflight_declared_entry_count(body + central + eocd)


def test_c_total_declared_uncompressed_size_over_cap_is_rejected_before_parser() -> (
    None
):
    # Each entry stays comfortably under the single-entry cap and has a
    # modest ratio; only their sum exceeds the total cap.
    per_entry_uncompressed = 100_000_000
    per_entry_compressed = per_entry_uncompressed // 100  # ratio 100, well under cap
    assert per_entry_uncompressed < MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES // 2
    entries = [
        (f"part{i}.xml", per_entry_compressed, per_entry_uncompressed, 0)
        for i in range(3)
    ]
    assert sum(e[2] for e in entries) > MAX_TOTAL_UNCOMPRESSED_BYTES
    with pytest.raises(ApiError, match="safe size limits"):
        _validate_xlsx_archive(_crafted_zip(entries))


def test_d_single_entry_over_cap_is_rejected_before_parser() -> None:
    file_size = MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES + 1
    compress_size = file_size // 100  # ratio 100, well under the ratio cap
    with pytest.raises(ApiError, match="safe size limits"):
        _validate_xlsx_archive(
            _crafted_zip([("sheet1.xml", compress_size, file_size, 0)])
        )


def test_e_suspicious_compression_ratio_is_rejected_before_parser() -> None:
    # Small in absolute terms (well under both size caps) but an implausible
    # compression ratio for real XML content.
    file_size = 10_000_000
    compress_size = 100
    assert file_size < MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES
    assert file_size / compress_size > MAX_COMPRESSION_RATIO
    with pytest.raises(ApiError, match="safe size limits"):
        _validate_xlsx_archive(
            _crafted_zip([("sheet1.xml", compress_size, file_size, 0)])
        )


def test_zero_length_benign_entry_does_not_divide_by_zero() -> None:
    _validate_xlsx_archive(_crafted_zip([("empty.xml", 0, 0, 0)]))  # does not raise


def test_encrypted_entry_is_a_controlled_reject() -> None:
    with pytest.raises(ApiError, match="could not be read"):
        _validate_xlsx_archive(_crafted_zip([("sheet1.xml", 100, 100, 0x1)]))


def test_unusual_compression_method_is_a_controlled_reject() -> None:
    # Every part of a real openpyxl XLSX is ZIP_DEFLATED; BZIP2 is valid ZIP
    # but never produced by a legitimate XLSX writer this app accepts.
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(zipfile.ZipInfo("sheet1.xml"), b"<x/>", zipfile.ZIP_BZIP2)
    with pytest.raises(ApiError, match="could not be read"):
        _validate_xlsx_archive(buffer.getvalue())


def test_f_malicious_xml_entities_are_rejected_by_the_hardened_parser() -> None:
    """`openpyxl` uses `defusedxml` when it's importable; `defusedxml`'s
    default policy forbids any `<!ENTITY>` declaration outright (not just
    ones that expand to something huge), so a single declared-but-unused
    entity is enough to prove the general protection this app relies on
    against both classic XXE and billion-laughs-style attacks — without this
    test itself needing to build an actual exponential payload."""
    malicious_sheet_xml = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE worksheet [<!ENTITY xxe "pwned">]>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="str"><v>&xxe;</v></c></row></sheetData>
</worksheet>"""
    malicious = _splice_worksheet_xml(_normal_workbook_bytes(), malicious_sheet_xml)
    _validate_xlsx_archive(malicious)  # ordinary ZIP metadata; not a size/ratio bomb
    with pytest.raises(ApiError, match="could not be read"):
        _parse(malicious)


def test_corrupt_archive_is_a_controlled_validation_error() -> None:
    with pytest.raises(ApiError, match="could not be read"):
        _validate_xlsx_archive(b"PK\x03\x04not a real zip central directory")


def test_workbook_is_closed_after_a_successful_parse() -> None:
    from openpyxl.workbook.workbook import Workbook as WorkbookType

    with patch.object(
        WorkbookType, "close", autospec=True, side_effect=WorkbookType.close
    ) as mocked_close:
        _parse(_normal_workbook_bytes())
    mocked_close.assert_called_once()


def test_workbook_is_closed_even_when_parsing_fails_after_load() -> None:
    from openpyxl.workbook.workbook import Workbook as WorkbookType

    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(["Фамилия", "Имя"])
    sheet.append(["A", "B"])
    sheet.merge_cells("A2:B2")  # rejected only after load_workbook succeeds
    buffer = BytesIO()
    workbook.save(buffer)

    with (
        patch.object(
            WorkbookType, "close", autospec=True, side_effect=WorkbookType.close
        ) as mocked_close,
        pytest.raises(ApiError, match="unmerged worksheet"),
    ):
        _parse(buffer.getvalue())
    mocked_close.assert_called_once()


def test_unexpected_error_logging_uses_route_template_and_redacts_details(
    caplog,
) -> None:  # type: ignore[no-untyped-def]
    leaked = "participant@example.org password=DoNotLogMe"
    scope = {
        "type": "http",
        "method": "GET",
        "scheme": "https",
        "path": "/tickets/private-id/private-signature",
        "raw_path": b"/tickets/private-id/private-signature",
        "query_string": b"token=private-token",
        "headers": [(b"cookie", b"staff_session=private-session")],
        "client": ("127.0.0.1", 12345),
        "server": ("api.example.org", 443),
        "route": SimpleNamespace(path="/tickets/{public_id}/{signature}"),
    }
    request = Request(scope)
    with caplog.at_level(logging.ERROR, logger="event_api"):
        response = asyncio.run(unexpected_error_handler(request, RuntimeError(leaked)))

    log = caplog.text
    body = json.loads(response.body)
    assert response.status_code == 500
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == "Request could not be completed"
    assert "/tickets/{public_id}/{signature}" in log
    for sensitive in [
        leaked,
        "participant@example.org",
        "DoNotLogMe",
        "private-id",
        "private-signature",
        "private-token",
        "private-session",
    ]:
        assert sensitive not in log
        assert sensitive not in response.body.decode()


def test_production_login_cookie_is_secure(
    client: TestClient, database_url: str
) -> None:
    from event_api.main import create_app

    email = f"release-cookie-{uuid4()}@example.org"
    password = "production cookie password"  # noqa: S105 - synthetic test value
    database: Database = client.app.state.database
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO staff_users
                   (id,tenant_id,organization_id,email,email_normalized,password_hash,system_role,active,
                    password_changed_at,created_at,updated_at)
                   VALUES (:id,'50000000-0000-4000-8000-000000000001',
                           '51000000-0000-4000-8000-000000000001',:email,:email,:password,'SUPER_ADMIN',TRUE,
                           UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": str(uuid4()),
                "email": email,
                "password": hash_password(password),
            },
        )
    config = Settings(
        database_url=database_url,
        node_env="production",
        cors_origins=[
            "https://events.example.org",
            "https://scanner.example.org",
        ],
        session_secret="s" * 43,
        auth_link_secret="a" * 43,
        auth_link_base_url="https://events.example.org/auth",
        qr_signing_secret="q" * 43,
        public_web_base_url="https://events.example.org",
        consent_url="https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf",
        privacy_policy_url="https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf",
        consent_version="release-cookie-test",
    )
    with TestClient(create_app(config)) as production:
        response = production.post(
            "/auth/login",
            headers={"Origin": "https://events.example.org"},
            json={"email": email, "password": password},
        )

    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "staff_session=" in cookie
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=lax" in cookie
    assert "expires=" in cookie


def test_login_route_enforces_shared_rate_limit_without_storing_email(
    client: TestClient, database_url: str
) -> None:
    from event_api.main import create_app

    email = f"rate-limit-{uuid4()}@example.org"
    config = Settings(
        database_url=database_url,
        node_env="test",
        cors_origins=["http://localhost:5173", "http://localhost:5174"],
        session_secret="r" * 43,
        auth_link_secret="a" * 43,
        auth_link_base_url="http://localhost:5173/auth",
        auth_rate_limit_max=2,
        auth_rate_limit_window_seconds=60,
        qr_signing_secret="q" * 43,
        public_web_base_url="http://localhost:5173",
        consent_url="https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf",
        privacy_policy_url="https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf",
        consent_version="rate-limit-test",
    )
    with TestClient(create_app(config)) as limited:
        responses = [
            limited.post(
                "/auth/login",
                headers={"Origin": "http://localhost:5173"},
                json={"email": email, "password": "incorrect test password"},
            )
            for _ in range(3)
        ]

    assert [response.status_code for response in responses] == [401, 401, 429]
    assert responses[0].json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert responses[1].json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert responses[2].json()["error"]["code"] == "RATE_LIMITED"
    database: Database = client.app.state.database
    with database.connect() as connection:
        keys = list(
            connection.execute(
                text("SELECT bucket_key FROM security_rate_limits")
            ).scalars()
        )
    assert all(email not in key for key in keys)
