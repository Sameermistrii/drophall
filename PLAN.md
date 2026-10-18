# DropHall plan

Shared board for Sameer, Claude and Cursor. Read before starting; update when done.

## Decided

- Name **DropHall**. Main domain **getdrophall.com**; **getdrophall.in** redirects to it. Instagram **@drophall**.
- A museum for **any** launch: software, physical products, posters (books, films, events, music).
- Promotion: Sameer's Instagram, X and YouTube.
- Exhibit types: **framed screen** (apps, AI tools), **glass case** (physical products),
  **poster wall**, **own room** (premium, designed by hand).
- Brand flow: pick a type, fill the form, upload files, pay, **Sameer approves**, it goes live.
  Rejected = refund, or one chance to fix.
- Physical products: photos are included; **a 3D model costs extra for complex products** (quoted per product).
- Not accepted: scams, gambling, "get rich" schemes, adult content, copied brands.
- Real launches are shown as-is; placeholders are marked **Sample** until replaced.

## Not decided yet

- Pricing and tiers (Claude + Sameer next).
- Museum layout as it grows (more rooms, prime spots).

## Now: Cursor

1. [x] `git init`, `.gitignore` (`graphify-out/cache/`, `node_modules/`, `.env`), first commit. Then `graphify hook install`. Remote: https://github.com/Sameermistrii/drophall
2. [ ] Put the site online: Cloudflare Pages (or Vercel). Connect getdrophall.com, redirect getdrophall.in. Sameer does the account steps.
3. [ ] Supabase project: `submissions` table (brand, contact, exhibit type, name, description, url, files, status `pending|approved|rejected`, created_at) and a storage bucket for uploads. RLS on: the public can insert only; only admin can read and update.
4. [ ] `submit.html`: the brand form, with fields that change by exhibit type (see the Exhibit your launch section in `index.html`). File limits: video ≤ 60 s, images ≤ 5 MB, logo PNG.
5. [ ] `admin.html`: Sameer logs in, sees pending submissions, approves or rejects with a note.
6. [ ] Payments with Razorpay, **after pricing is decided**.

## Now: Claude

- [ ] Pricing and tiers with Sameer.
- [ ] Museum: show real images and videos inside frames, posters and cases (an `image` / `video` field on exhibits).
- [ ] Museum: load approved exhibits from Supabase once Cursor's table exists (agree the format here first).
- [ ] Media kit and pitch messages for brands.

## Requests for Claude

_(Cursor: add a line here when you need a change in `js/museum.js` or the site's look.)_

## Requests for Cursor

_(Claude: add a line here when you need something built or deployed.)_

## Done log

- 2026-10-18 Claude: first version of the site (museum walk, Directory, Exhibit your launch).
- 2026-10-18 Claude: finished the graphify graph build (`graphify-out/`).
- 2026-10-18 Claude: wrote AGENTS.md and this plan.
- 2026-10-18 Cursor: git setup (`.gitignore`, first commit, graphify hook) and pushed `main` to github.com/Sameermistrii/drophall.
