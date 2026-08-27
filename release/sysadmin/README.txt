EVENT REGISTRATION 1.0 — PACKAGE FOR THE ORGANISATION ADMINISTRATOR

Contents:
frontend/web       compiled public and administration site for Apache
frontend/scanner   compiled scanner PWA for Apache
backend/*.whl      compiled CPython 3.12 bytecode-only backend package
backend/requirements.txt  exact runtime dependency versions
config/backend.env.example database and application configuration template
apache/            example Apache virtual hosts (not an installation script)
database/          new-database SQL template and source migrations
MANIFEST.json      source revision and SHA-256 hashes

Not included:
MySQL binaries, Docker files, systemd units, installation/deployment scripts,
TLS private keys, passwords, application secrets, source code and node_modules.

Server prerequisites:
- an organisation-managed MySQL server exactly version 8.1.0;
- CPython exactly 3.12 with pip;
- Apache HTTP Server with proxy/proxy_http/headers/rewrite/ssl modules;
- TLS certificates and an organisation-selected process manager for the API
  and email worker.

Database:
1. Execute database/00_create_database.sql as a database administrator.
2. Execute database/01_schema.sql in the new database.
3. Optionally adapt database/02_users_and_grants.example.sql to create separate
   runtime and migration accounts. Never keep completed credentials here.

Backend:
Create a CPython 3.12 virtual environment, then install the exact dependencies
and compiled wheel using commands equivalent to:

  python3.12 -m pip install -r backend/requirements.txt
  python3.12 -m pip install --no-deps backend/*.whl

The application wheel contains CPython 3.12 bytecode and package metadata, not
the backend `.py` source files. It is not a standalone native executable and
therefore requires the stated CPython runtime and dependencies.

Transfer config/backend.env.example values to the organisation's protected
configuration mechanism. DATABASE_URL is the MySQL connection string. All
three cryptographic secrets must be different and generated securely. Start
`event-api` and `event-email-worker` under the organisation's process manager.
The API must listen only on 127.0.0.1:3000.

Apache:
Copy frontend/web and frontend/scanner to the DocumentRoot locations selected
by the organisation. Adapt apache/event-registration.conf.example with real
domains and TLS certificate directives. The compiled clients call `/api`, so
Apache must proxy that path to http://127.0.0.1:3000/ as shown in the example.

First administrator:
After the database schema, backend, HTTPS and Apache are working, run under the
same protected backend configuration:

  event-bootstrap-admin --email admin@example.org

The command does not ask for or store a password. It prints one temporary,
single-use HTTPS link. The intended administrator opens it and sets the first
password in the browser. The command refuses to create another link while a
valid one exists or after a SUPER_ADMIN has been activated.

Acceptance:
Check /api/health/live and /api/health/ready through Apache, sign in as the
first administrator, create a test event, and verify Scanner camera access on
a real HTTPS device. Keep MANIFEST.json for integrity verification.
