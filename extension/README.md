# Study Engine (Chrome extension)

A writing assistant that teaches. In text boxes on any website, Study Engine checks spelling, grammar, punctuation, clarity, word choice and tone, and fact-checks research papers. Its study mode turns the underline into a question, so students do the thinking. The editor adds the full study engine: study guides from notes, quizzes, vocabulary coaching and exam rehearsal.

Plain HTML, CSS and JavaScript (Manifest V3), with no build step and nothing to install.

## Load it in Chrome

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension` folder.
3. Pin it: click the puzzle-piece icon next to the address bar, then the pin next to Study Engine.
4. The settings page opens. Spelling, grammar and style checks work straight away. To turn on AI checks, paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) and click **Save key**; Study Engine tests it for you.

After you change any file, click the reload icon on Study Engine's card in `chrome://extensions`, then reload the pages you're testing on.

## What it does

### On any website

Click into a text box, such as Gmail, Slack, Notion, LinkedIn, a school portal or a comment box, and start typing.

| Underline | What it means |
|---|---|
| Red | **Correctness**: spelling, grammar, punctuation. One click fixes it. |
| Blue | **Clarity**: wordy phrases, redundancy, long sentences, passive voice. |
| Green | **Engagement**: weak words ("very good" → "excellent") and clichés. |
| Purple | **Tone**: contractions and slang in academic writing, hedging in work email. |
| Orange, dashed | **Facts**: a claim to recheck, with what the sources say and links to them. |
| Blue, dotted | **Study mode**: a question about your reasoning, or a nudge toward the precise word. |

- **Hover or click** an underline for its card: accept a fix, dismiss it, or add a word to your dictionary.
- **The green button** in the corner of the text box opens the assistant panel. It shows a writing score, every suggestion by kind, the tone, a one-click **Accept all** for spelling and grammar, **Check facts now**, and word count, reading time and grade level.
- **Goals**: each site starts with a goal that fits it (Professional for email, Casual for chat, Academic for school sites, General elsewhere). Change it in the panel or the toolbar popup.
- **Study mode** (per site): questions instead of fixes. Spelling and grammar still get direct fixes; everything else asks you to do the work, and the answer box checks your answer. Study Engine never writes graded work.
- **Your glossary** (from Live Definitions): finish typing a term from your glossary and its definition appears at the cursor. Press Tab to insert it. Import a CSV on the settings page.
- **Right-click selected text → Check with Study Engine** opens it in the editor.

### Fact checks for papers

With AI checks on, paragraphs with dates, numbers, names or claims are fact-checked once you move on from them, in longer writing such as papers (not in short messages). Claude searches the web, then flags only claims that reliable sources contradict, that are misleading, or that it couldn't verify. The card says what the sources say, gives a correction when there's one right answer, and links the sources. Study Engine never changes a fact for you: check it, then edit it yourself. In settings you can run fact checks only when you click **Check facts**, or turn web search off (Claude then checks against what it knows, and says so).

### The editor

Click the toolbar button, then **Open the editor**. It's the Study Engine app:

- **Your documents**: as many as you like, saved in this browser. Mark one as notes to build a study guide from it.
- **Review**: the same writing review and fact checks as on web pages, with a writing score.
- **Questions**: **Ask me questions** reads your draft and asks where you haven't shown what you know.
- **Guide, Practice, Words, Exam**: study guides with fill-in-the-blanks, locked answers and flashcards; quizzes; vocabulary coaching (Seen, Tried, Used, Owned); exam profiles such as the AP DBQ, with timed rehearsals.
- **Examples**: four sample documents show each feature, and work without AI.
- Modes: **Study** (questions; the review underlines mistakes and facts), **Write** (the full review, plus at most one question per paragraph), **Rehearse** (nothing until time's up) and **Polish** (the full review and rubric checks).

## How the checks work

| Check | Where it runs | Needs |
|---|---|---|
| Spelling | Your browser: a 158,000-word dictionary built from SCOWL, plus school-subject terms (`data/`). British spellings in American English, and the reverse, are labeled as such, with the other spelling offered. | Nothing |
| Grammar, punctuation, clarity, word choice, tone rules | Your browser (`lib/rules.js`), on every keystroke | Nothing |
| Grammar in context, tone, rewording | Claude Haiku 5.5, a moment after you pause, one paragraph at a time | API key |
| Fact checks | Claude Sonnet 5.5 with web search | API key |
| Study questions, grading answers, study guides | Claude Sonnet 5.5 and Haiku 5.5 | API key |

Models can be changed in settings. Each kind of check tells Claude how much effort to spend: low for writing checks and grading, medium for fact checks and study questions. AI prompts follow the Study Engine prompt library: a shared base prompt, sentence IDs instead of character positions, exact quotes that code maps back to the text (and drops if they don't match), JSON schemas enforced with structured output, and empty results allowed.

Results are cached for the browser session, identical requests share one call, at most three run at once, and Study Engine pauses AI checks if a page makes more than 45 in a minute.

## Privacy

- **On your device**: spelling, grammar and style rules, your dictionary, your glossary and the editor's documents. These never leave your browser.
- **Sent to Anthropic, only with AI checks on**: the paragraph being checked, or the text you ask about, straight to Anthropic's API with your key, and nowhere else. AI checks are billed to your Anthropic account.
- **Your API key** is stored in the extension's own storage, where web pages and content scripts can't read it.
- **Never checked**: password fields, payment fields, and fields a site marks as off-limits for writing assistants (`data-gramm="false"`). Code editors are skipped. In email, quoted replies and signatures are skipped.
- No analytics, no tracking, no ads, no fonts or scripts from the web.

## Permissions

| Permission | Why |
|---|---|
| Content script on all sites | To check text boxes wherever you write. |
| `storage` | Settings, your dictionary, glossary and documents. |
| `contextMenus` | **Check with Study Engine** on selected text. |
| `https://api.anthropic.com/*` | AI checks, only after you add a key. |

## Limits

- **Google Docs** draws its text on a canvas that extensions can't read. Copy the text into the editor, or right-click a selection and choose **Check with Study Engine**.
- English only (American or British spelling, in settings).
- No plagiarism checker, and by design no "write it for me": Study Engine suggests fixes to your sentences but doesn't generate new content.

## Files

| Path | What it is |
|---|---|
| `manifest.json` | Extension manifest |
| `background.js` | Service worker: spelling, calls to Claude, opening the editor, the right-click menu |
| `lib/text.js` | Sentences, words, readability, and the spans never checked (links, emails, code) |
| `lib/spell.js` | Spell checker and suggestions |
| `lib/rules.js` | Grammar, punctuation, clarity, word-choice and tone rules, and the writing goals |
| `lib/prompts.js` | AI prompts and their JSON schemas |
| `lib/settings.js`, `lib/secrets.js` | Settings; the API key's storage |
| `content/` | What runs on web pages: reading fields (`model.js`), underlines (`overlay.js`), cards, badge and panel (`ui.js`), each field's checks (`session.js`), the glossary (`glossary.js`) and start-up (`main.js`) |
| `editor/` | The Study Engine editor |
| `popup/`, `options/` | Toolbar popup and settings page |
| `data/` | Spelling dictionaries (`dict-*.txt`), words only one dialect accepts (`variants-*.txt`), Study Engine's additions (`extra-words.txt`), and SCOWL's license |
| `fonts/`, `icons/` | Figtree and IBM Plex Mono, with their SIL Open Font License texts; icons |

Tests and build tools live next to this folder, in `../tests` and `../tools`. From the `study-engine` folder:

- `node --test tests/engine.test.mjs`: the rules and the spell checker (20 tests).
- `node --test --test-concurrency=1 tests/extension.test.mjs`: the whole extension in headless Chrome, with a stand-in for the Anthropic API (25 tests: every kind of field, a Quill editor, iframes, pages with a strict Content-Security-Policy, fixes and undo, the dictionary, goals, the glossary, AI writing checks, fact checks with sources, study mode, errors, the settings page, the popup, the editor, and that the API key never reaches a web page).
- `node tests/corpus-check.mjs <folder>`: runs the checks over well-edited text (such as saved Wikipedia articles) and lists what they flag, to catch false positives.
- `node tests/perf.mjs`: how long a keystroke takes in a long document.
