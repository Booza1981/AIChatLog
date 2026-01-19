# Extension-baked Chromium image for server deployments (no bind mounts needed)
FROM lscr.io/linuxserver/chromium:latest

ARG EXTENSION_BUILD=dev

COPY chrome-extension /opt/extension
RUN echo "$EXTENSION_BUILD" > /opt/extension/.build \
  && chown -R abc:abc /opt/extension
