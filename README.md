# DropHall

The museum of new launches. Domain: getdrophall.com (getdrophall.in redirects to it).

## Open it

Double-click `index.html`. It runs straight from this folder, no install needed.
(Fonts load from Google Fonts, so you need internet for the proper lettering.)

## Files

| File | What it is |
|---|---|
| `index.html` | The page: museum walk, Directory, Exhibit your launch |
| `css/style.css` | All the styling |
| `js/data.js` | **The collection.** Rooms and exhibits live here |
| `js/museum.js` | The 3D museum (built with three.js) |
| `js/site.js` | Directory search and room filters |
| `js/vendor/three.min.js` | three.js r149 (MIT licence, see three-LICENSE.txt) |

## Add an exhibit

Open `js/data.js` and add one entry to `EXHIBITS`:

```js
{id: 'myapp', room: 'software', kind: 'frame', name: 'My App', maker: 'My Company',
 desc: 'One or two sentences about the launch.', medium: 'Web app', year: 2026,
 color: '#3a7bd5', url: 'https://example.com'},
```

- `room`: `software`, `objects` or `prints` (or add a new room to `ROOMS`; it gets its own gallery and doorway)
- `kind`: `frame` (framed screen), `case` (object in a glass case, also set `shape`: `bottle`, `buds`, `speaker` or `box`), `poster`
- `sample: true` shows the "Sample" tag. Remove the sample entries as real launches come in.

The museum, the directory and the accession numbers (DH.2026.001...) update by themselves.

## Put it online

Any static host works (Cloudflare Pages, Netlify, Vercel, GitHub Pages). Upload this folder as-is,
then point getdrophall.com at it and redirect getdrophall.in to getdrophall.com.
