import { writeFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import toIco from "to-ico"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="4.5" fill="oklch(0.5417 0.1790 288.0332)"/>
  <path d="M8 5v14l11-7z" fill="white"/>
</svg>
`

const png32 = await sharp(Buffer.from(svg)).resize(32, 32).png().toBuffer()
const png180 = await sharp(Buffer.from(svg)).resize(180, 180).png().toBuffer()
writeFileSync(join(__dirname, "../app/favicon.ico"), await toIco([png32]))
writeFileSync(join(__dirname, "../app/apple-icon.png"), png180)
