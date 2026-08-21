# Chatbot

The chatbot is a deterministic, dataset-grounded assistant exposed at
`POST /api/chat`. It accepts a message plus optional farm context and returns
a reply, suggestions, actions, and updated context.

Supported slash commands: `/help`, `/recommend`, `/forecast` (`/price`),
`/rotation`, `/mspvsmarket`, `/msp`, `/mandi`, `/pest`, `/sell`, `/irrigate`,
`/calendar`, `/schemes` (`/scheme`), `/loan`, `/crops`, and `/regions`. An
unrecognised `/command` replies with the list above rather than falling through
to the generic "didn't catch that" message. The frontend stores only the current conversation context in local
storage; server responses are derived from local crop, price, weather, and
scheme datasets.

Run the site through the FastAPI server rather than opening HTML files directly
so the `/api/chat` request can reach the backend.
