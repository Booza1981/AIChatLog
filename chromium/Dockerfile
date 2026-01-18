# Extension-baked Chromium image for server deployments (no bind mounts needed)
FROM lscr.io/linuxserver/chromium:latest

COPY chrome-extension /opt/extension
RUN chown -R abc:abc /opt/extension
