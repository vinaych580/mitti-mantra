# Chatbot

The chatbot is a deterministic, dataset-grounded assistant exposed at
`POST /api/chat`. It accepts a message plus optional farm context and returns
a reply, suggestions, actions, and updated context.

Supported slash commands include `/help`, `/recommend`, `/msp`, `/mandi`,
`/pest`, `/sell`, `/irrigate`, `/calendar`, `/schemes`, `/loan`, `/crops`, and
`/regions`. The frontend stores only the current conversation context in local
storage; server responses are derived from local crop, price, weather, and
scheme datasets.

Run the site through the FastAPI server rather than opening HTML files directly
so the `/api/chat` request can reach the backend.
