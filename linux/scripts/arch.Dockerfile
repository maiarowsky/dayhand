# Arch Linux with what Dayhand for Linux needs to build and test (scripts/container-test.sh).
# The image and the packages are pinned to dates more than a week old: the image tag, and the
# Arch Linux Archive snapshot pacman installs from.
FROM archlinux:base-20261011.0.609700

ARG ARCHIVE_DATE=2026/10/16
# pacman's syscall sandbox does not work under emulation (an arm64 Mac running amd64), so it is off.
RUN sed -i 's/^\[options\]/[options]\nDisableSandbox/' /etc/pacman.conf \
 && echo "Server = https://archive.archlinux.org/repos/${ARCHIVE_DATE}/\$repo/os/\$arch" > /etc/pacman.d/mirrorlist \
 && pacman -Syyu --noconfirm --needed \
      cmake ninja gcc pkgconf \
      qt6-base qt6-declarative qt6-wayland \
      libsecret gnome-keyring dbus tzdata ttf-dejavu \
 && pacman -Scc --noconfirm

RUN useradd -m builder
USER builder
WORKDIR /src
