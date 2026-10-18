// DropHall collection. Add a new exhibit by adding one entry to EXHIBITS.
// room   = which gallery it hangs in (an id from ROOMS)
// kind   = "frame" (framed screen on the wall), "case" (object in a glass case), "poster" (poster on the wall)
// shape  = for kind "case": "bottle" | "buds" | "speaker" | "box"
// sample = true marks a placeholder exhibit, shown with a "Sample" label until a real launch takes the spot
window.ROOMS = [
  {id: 'software', name: 'Software & AI', wall: '#5a1e25', floor: 'oak'},
  {id: 'objects', name: 'Objects', wall: '#22324c', floor: 'marble'},
  {id: 'prints', name: 'Prints & Posters', wall: '#2c4636', floor: 'oak'},
];

window.EXHIBITS = [
  {id: 'voicebox', room: 'software', kind: 'frame', name: 'Voicebox', maker: 'jamiepine',
   desc: 'An open-source voice studio. Clone a voice from a few seconds of audio and generate speech in 23 languages, all on your own computer.',
   medium: 'Open-source app, MIT licence', year: 2026, color: '#e0703a', url: 'https://github.com/jamiepine/voicebox'},
  {id: 'graphify', room: 'software', kind: 'frame', name: 'Graphify', maker: 'Graphify Labs',
   desc: 'Turns a whole codebase into a knowledge graph, so coding agents query the graph instead of re-reading every file.',
   medium: 'Open-source tool, runs locally', year: 2026, color: '#5fb0a6', url: 'https://github.com/Graphify-Labs/graphify'},
  {id: 'ecc', room: 'software', kind: 'frame', name: 'ECC', maker: 'affaan-m',
   desc: 'Everything Claude Code: 71 agents, 311 skills and 97 commands that turn Claude Code into a whole engineering team.',
   medium: 'Open-source toolkit, MIT licence', year: 2026, color: '#c9a45c', url: 'https://github.com/affaan-m/ECC'},
  {id: 'replica', room: 'software', kind: 'frame', name: 'Replica', maker: 'jakeschincariol',
   desc: 'Eleven Claude skills that study an app, rebuild it, read its real reviews and fix what users dislike.',
   medium: 'Open-source skills, MIT licence', year: 2026, color: '#8f7ad6', url: 'https://github.com/jakeschincariol/replica-skill'},
  {id: 'aster', room: 'objects', kind: 'case', shape: 'bottle', sample: true, name: 'Aster Bottle', maker: 'Sample brand',
   desc: 'A sample object exhibit. A physical product sits in a lit glass case, turning slowly so visitors see every side.',
   medium: 'Steel, powder coat', year: 2026, color: '#d9d4c7', url: ''},
  {id: 'halo', room: 'objects', kind: 'case', shape: 'buds', sample: true, name: 'Halo Buds', maker: 'Sample brand',
   desc: 'A sample object exhibit. Small gadgets get their own case, plinth and wall label, the same as a museum piece.',
   medium: 'Polycarbonate, aluminium', year: 2026, color: '#eef0f2', url: ''},
  {id: 'cube', room: 'objects', kind: 'case', shape: 'speaker', sample: true, name: 'Cube Speaker', maker: 'Sample brand',
   desc: 'A sample object exhibit. Brands can send photos or a 3D file; complex products get a 3D model made for them.',
   medium: 'Fabric, walnut', year: 2026, color: '#3b3f46', url: ''},
  {id: 'poster', room: 'prints', kind: 'poster', sample: true, name: 'Launch Night', maker: 'Sample brand',
   desc: 'A sample poster exhibit, for books, films, events, courses and music releases.',
   medium: 'Poster, 50 × 70 cm', year: 2026, color: '#e85d4a', url: ''},
];

// Accession numbers, like a real museum catalogue: DH.<year>.<order>
window.EXHIBITS.forEach((e, i) => { e.acc = 'DH.' + e.year + '.' + String(i + 1).padStart(3, '0'); });
