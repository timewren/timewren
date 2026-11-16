FROM alpine:3.21
RUN apk add --no-cache curl tzdata supercronic \
    && cp /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime \
    && echo "Europe/Copenhagen" > /etc/timezone
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Non-root (Trivy DS-0002). Busybox crond can't load/run jobs without root,
# so the entrypoint uses supercronic which runs fine as an unprivileged user.
USER cron
ENTRYPOINT ["/entrypoint.sh"]
