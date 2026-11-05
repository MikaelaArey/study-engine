# Study Engine

A writing assistant that teaches. This folder holds two things:

- **The Study Engine Chrome extension** (`extension/`): spelling, grammar, clarity, tone and fact checks in text boxes on any website, a study mode that asks instead of fixing, and the Study Engine editor. **This is the product.** See [extension/README.md](extension/README.md) to load it in Chrome.
- **The localhost prototype** (this page): the original demo of the study mode, which runs at <http://localhost:3001>. Useful for showing the four study features without installing anything.

| Path | What it is |
|---|---|
| `extension/` | The Chrome extension |
| `tests/` | `engine.test.mjs` (rules and spelling, in Node) and `extension.test.mjs` (the extension in headless Chrome, with a stand-in for the Anthropic API) |
| `tools/build-dictionary.py` | Rebuilds the spelling dictionaries from SCOWL |
| `public/`, `server.js`, `Open Study Engine.command` | The localhost prototype |

## The localhost prototype

A working prototype of a study mode for a writing assistant. The underline becomes a question: it asks, gives hints and checks answers, and never writes graded work. Notes become a study guide the student answers, vocabulary is coached rather than swapped in, and drafts are checked against exam rubrics.

It runs on your computer at <http://localhost:3001>. It's plain HTML, CSS and JavaScript with a small Node server and nothing to install.

### Open it

Double-click **Open Study Engine.command**. It starts the server and opens the app in your browser. Keep the Terminal window open while you use it; close it (or press Ctrl+C) to stop.

The first time, macOS may say the file can't be opened because it's from an unidentified developer. If it does, right-click the file, choose **Open**, then **Open** again.

From a terminal instead: `npm start` (or `node server.js --open`).

If port 3001 is taken, Study Engine uses the next free port and prints the address. Foundry uses 3000, so both can run at once.

### Live AI (optional)

Without a key, Study Engine runs in **demo mode**. All four sample documents work fully, and answers are checked against the sample answer keys.

With an Anthropic API key, the top bar shows **Live AI on**:

- Answers are checked by Claude, so any wording works.
- **Check with live AI** asks questions about your own writing.
- Your own notes can be turned into a study guide.
- **Ask Claude to judge** checks a draft against the exam rubric.

To turn it on, open the `.env` file in this folder (it's created on first run, and hidden in Finder: press Cmd+Shift+. to show it), paste your key after `ANTHROPIC_API_KEY=`, save, and start Study Engine again. Keys come from <https://console.anthropic.com>. Calls use your Anthropic account and are billed to it.

### A good order for a demo

1. **Why Britain industrialized first** (the essay). Click the blue underline under "because Britain had lots of coal", answer "colonies", then add a second cause. The underline clears once you've shown you know it. Try **Write** and **Polish** in the top bar to see how much help each mode shows.
2. **Yeast fermentation lab**. Click "broke", type "denatured", then rewrite the sentence in the document yourself. The card confirms the word and counts it toward owning it.
3. **Cellular respiration notes**. In the Guide tab, choose **Turn into study guide**. Fill in the blanks, try a locked answer, flip a flashcard, and use **Add the textbook chapter** to fill the gap. Then take the five-minute quiz in the Practice tab.
4. **DBQ practice**. The Exam tab shows 2 of 6 rubric criteria met. Add a sentence citing (Doc 6) and watch the evidence criterion change, then start a rehearsal and try the sourcing drill.

**Reset the demo**, at the bottom of the documents menu, puts everything back to the start.

### Privacy

The server listens only on this computer, and only Study Engine's own pages can use its AI route. Progress is saved in your browser. Nothing is sent anywhere unless live AI is on; then the text being checked goes to Anthropic's API. The API key stays in `.env` on this computer and never reaches the browser.

### Files

| Path | What it is |
|---|---|
| `Open Study Engine.command` | Double-click launcher |
| `server.js` | Local server: serves `public/` and the live AI route |
| `public/index.html` | The app's page |
| `public/styles.css` | Styles: white and green |
| `public/app.js` | The app: underlines, cards, guide, quizzes, words, exam |
| `public/data.js` | Sample documents, guide, quizzes, rubric profiles and drill |
| `public/fonts/` | Figtree and IBM Plex Mono, served locally (SIL Open Font License) |
| `.env.example` | Settings template; copied to `.env` on first run |
