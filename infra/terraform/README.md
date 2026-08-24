# Terraform scaffold

This directory reserves separate Yandex Cloud roots for `staging` and
`production`. No billable resources are declared until topology, sizing, zones,
domains, retention and budget are approved.

Each environment receives credentials through the deployment system. Never put
service-account keys or production variable values in this repository.

Application release mechanics, health endpoints and migration sequencing are
defined in `docs/15-deployment.md`. Backup/restore operations are defined in
`docs/runbooks/backup-restore.md`. This scaffold intentionally remains
non-billable until the open provider-specific decisions are approved.
