curl -N -X POST http://127.0.0.1:9876/agents \
  -H "x-openai-key: $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --data-raw '{"model": "gpt-5.4-mini", "prompt": "What language is the /linkchecker repo written in?", "stream": true}'
