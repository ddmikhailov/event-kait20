FROM golang:1.25.13-bookworm@sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48 AS gosu-build
RUN CGO_ENABLED=0 go install github.com/tianon/gosu@6456aaa0f3c854d199d0f037f068eb97515b7513

FROM mysql:8.1.0@sha256:f61944ff3f2961363a4d22913b2ac581523273679d7e14dd26e8db8c9f571a7e

# MySQL stays exactly 8.1.0; only supported Oracle Linux packages are patched.
USER root
RUN microdnf --disablerepo=mysql-tools-community \
      --disablerepo=mysqlinnovation-server-minimal update -y \
    && microdnf clean all
RUN microdnf remove -y mysql-shell python39 python39-libs python39-pip \
      python39-pip-wheel python39-setuptools python39-setuptools-wheel \
    && microdnf clean all
COPY --from=gosu-build /go/bin/gosu /usr/local/bin/gosu
