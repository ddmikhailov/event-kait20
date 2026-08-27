from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import os
import py_compile
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def digest(path: Path) -> tuple[str, int]:
    content = path.read_bytes()
    encoded = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=")
    return f"sha256={encoded.decode('ascii')}", len(content)


def compile_wheel(source: Path, output_dir: Path) -> Path:
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("The release backend must be compiled with CPython 3.12")
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="event-backend-wheel-") as temporary:
        root = Path(temporary)
        with zipfile.ZipFile(source) as archive:
            archive.extractall(root)

        package = root / "event_api"
        sources = sorted(package.rglob("*.py"))
        if not sources:
            raise SystemExit("No backend application sources found in input wheel")
        for path in sources:
            relative = path.relative_to(root).as_posix()
            py_compile.compile(
                str(path),
                cfile=str(path.with_suffix(".pyc")),
                dfile=relative,
                doraise=True,
                optimize=2,
                invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH,
            )
            path.unlink()

        dist_info = next(root.glob("*.dist-info"))
        wheel_metadata = dist_info / "WHEEL"
        lines = [
            line
            for line in wheel_metadata.read_text(encoding="utf-8").splitlines()
            if not line.startswith(("Generator:", "Tag:"))
        ]
        lines.extend(
            [
                "Generator: event-registration bytecode release builder",
                "Tag: cp312-none-any",
            ]
        )
        wheel_metadata.write_text("\n".join(lines) + "\n", encoding="utf-8")

        record = dist_info / "RECORD"
        files = sorted(
            path for path in root.rglob("*") if path.is_file() and path != record
        )
        with record.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, lineterminator="\n")
            for path in files:
                checksum, size = digest(path)
                writer.writerow((path.relative_to(root).as_posix(), checksum, size))
            writer.writerow((record.relative_to(root).as_posix(), "", ""))

        target = output_dir / source.name.replace("py3-none-any", "cp312-none-any")
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(item for item in root.rglob("*") if item.is_file()):
                archive.write(path, path.relative_to(root).as_posix())

    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        if any(
            name.startswith("event_api/") and name.endswith(".py") for name in names
        ):
            target.unlink(missing_ok=True)
            raise SystemExit("Compiled wheel still contains backend .py sources")
        if not any(
            name.startswith("event_api/") and name.endswith(".pyc") for name in names
        ):
            target.unlink(missing_ok=True)
            raise SystemExit("Compiled wheel contains no backend bytecode")

    with tempfile.TemporaryDirectory(prefix="event-backend-install-") as temporary:
        verification_env = {
            **os.environ,
            "NODE_ENV": "test",
            "DATABASE_URL": "mysql://test:test@127.0.0.1/event_registration",
            "CORS_ORIGINS": "http://localhost:5173",
            "SESSION_SECRET": "s" * 43,
            "AUTH_LINK_SECRET": "a" * 43,
            "AUTH_LINK_BASE_URL": "http://localhost:5173/auth",
            "QR_SIGNING_SECRET": "q" * 43,
            "PUBLIC_WEB_BASE_URL": "http://localhost:5173",
            "CONSENT_URL": "http://localhost:5173/privacy",
            "CONSENT_VERSION": "release-build-test",
        }
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--quiet",
                "--no-deps",
                "--target",
                temporary,
                str(target),
            ],
            check=True,
        )
        subprocess.run(
            [
                sys.executable,
                "-I",
                "-c",
                "import sys; sys.path.insert(0, sys.argv[1]); "
                "import event_api.main, event_api.bootstrap",
                temporary,
            ],
            check=True,
            env=verification_env,
        )
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    target = compile_wheel(args.source.resolve(), args.output_dir.resolve())
    print(target)


if __name__ == "__main__":
    main()
