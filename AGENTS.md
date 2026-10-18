# DropHall: instructions for Cursor

DropHall (getdrophall.com) is a 3D museum of new launches. Visitors scroll through galleries;
brands pay to have their product shown as an exhibit. Owner: Sameer (@drophall on Instagram).

Two AIs work on this folder: **Cursor (you)** and **Claude** (in the Claude app, works through
this folder from the cloud). Sameer passes messages between us. `PLAN.md` is the shared board:
read it before starting, update it when you finish something.

## Who owns what

| Area | Owner | Files |
|---|---|---|
| 3D museum (rooms, exhibits, camera, lighting) | Claude | `js/museum.js` |
| Look and wording of the public site | Claude | `css/style.css`, text in `index.html` |
| Exhibit data format | Claude (format), anyone (entries) | `js/data.js` |
| Git, hosting, domains | Cursor | `.gitignore`, deploy config |
| Brand submission form and uploads | Cursor | `submit.html`, `js/submit.js` (new) |
| Database and storage | Cursor | `supabase/` (new) |
| Admin review page | Cursor | `admin.html`, `js/admin.js` (new) |
| Payments | Cursor (after pricing is decided) | new files |

**Do not edit `js/museum.js`.** If you need a change there (for example, exhibits loading
from the database, or real images and videos in frames), write it under
"Requests for Claude" in `PLAN.md` and tell Sameer.
You may add a nav link or a script tag to `index.html`; leave the rest of its structure alone.

## How the site works

- Plain static site: `index.html` + `css/style.css` + `js/*.js`. No build step, no framework.
  Keep it that way unless Sameer agrees otherwise. New pages follow the same pattern and reuse
  the colour and font tokens at the top of `css/style.css`.
- `js/data.js` defines `window.ROOMS` and `window.EXHIBITS`. `js/museum.js` (three.js r149,
  vendored in `js/vendor/`) and `js/site.js` (Directory section) read them on page load.
- Exhibit fields: `id, room, kind ('frame'|'case'|'poster'), shape (case only), name, maker, desc,
  medium, year, color, url, sample`. Keep these names; the museum depends on them.
- Opens straight from disk (double-click `index.html`).

## Rules

- **graphify:** before exploring code, use `graphify query "<question>"`. After changing code,
  run `graphify update .`. Once git is set up, run `graphify hook install` once.
- **Secrets:** never commit keys. The Supabase anon key may go in front-end code only with
  Row Level Security on every table. The service-role key never goes in front-end code.
- **Sameer's accounts:** guide him through sign-ups, logins and payments. Never type his
  passwords, card or bank details yourself.
- **Small changes:** the smallest thing that works; no new dependency for a few lines.
- After finishing a task: commit, run `graphify update .`, tick it in `PLAN.md`, and add a
  one-line entry to the Done log.
