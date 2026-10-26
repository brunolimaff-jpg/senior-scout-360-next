#!/bin/bash
# Sobe Next + resolve-service se não estiverem vivos (idempotente).
# O resolve-service sobe com supervisor (reinicia sozinho se o SDK travar nativamente).
cd /home/z/my-project
if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/api/stats; then
  nohup bun run dev > dev.log 2>&1 &
fi
if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:3030/health; then
  cd mini-services/resolve-service
  nohup bun run dev:resiliente > /tmp/resolve-service.log 2>&1 &
  cd /home/z/my-project
fi
for i in $(seq 1 30); do
  curl -s -o /dev/null --max-time 3 http://localhost:3000/api/stats && curl -s -o /dev/null --max-time 3 http://127.0.0.1:3030/health && break
  sleep 2
done
curl -s -o /dev/null --max-time 5 http://localhost:3000/api/stats && echo "next:ok" || echo "next:FALHOU"
curl -s -o /dev/null --max-time 5 http://127.0.0.1:3030/health && echo "service:ok" || echo "service:FALHOU"
