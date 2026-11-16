# Railway's repository deploy flow needs a Dockerfile. This only pulls the
# published image; it does not compile the application.
FROM ghcr.io/timewren/timewren:latest

# The image already runs as nextjs (uid 1001); stated here so scanners and
# Railway see a non-root user.
USER nextjs
