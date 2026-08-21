# Terraform scaffold

This directory reserves separate Yandex Cloud roots for `staging` and
`production`. No billable resources are declared until topology, sizing, zones,
domains, retention and budget are approved.

Each environment receives credentials through the deployment system. Never put
service-account keys or production variable values in this repository.
