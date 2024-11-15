const CDG_NOOP = 0 // eslint-disable-line no-unused-vars
const CDG_MEMORY_PRESET = 1
const CDG_BORDER_PRESET = 2
const CDG_TILE_BLOCK = 6
const CDG_SCROLL_PRESET = 20
const CDG_SCROLL_COPY = 24
const CDG_SET_KEY_COLOR = 28
const CDG_LOAD_CLUT_LOW = 30
const CDG_LOAD_CLUT_HI = 31
const CDG_TILE_BLOCK_XOR = 38

const CDEG_MEMORY_CONTROL = 3
const CDEG_TILE_BLOCK_2 = 6
const CDEG_TILE_BLOCK_2_XOR = 14
const CDEG_LOAD_CLUT_0 = 16
const CDEG_LOAD_CLUT_248 = 47
const CDEG_LOAD_CLUT_2_0 = 48
const CDEG_LOAD_CLUT_2_240 = 63

const CDG_SCROLL_NONE = 0 // eslint-disable-line no-unused-vars
const CDG_SCROLL_LEFT = 1
const CDG_SCROLL_RIGHT = 2
const CDG_SCROLL_UP = 1
const CDG_SCROLL_DOWN = 2

const CDG_DATA = 4
const PACKET_SIZE = 24
const SECONDARY_MEMORY_CLUT_START = 16

/************************************************
* CDGContext represents a specific state of
* the screen, clut and other CDG variables.
************************************************/
class CDGContext {
  constructor () {
    this.init()
  }

  init () {
    this.hOffset = 0
    this.vOffset = 0
    this.hOffset_2 = 0
    this.vOffset_2 = 0
    this.keyColor = null // clut index
    this.bgColor = null // clut index
    this.borderColor = 0 // clut index
    this.clut = new Array(256).fill([0, 0, 0]) // color lookup table
    this.clut6_bits = new Array(256).fill([0, 0, 0]) // source bits for update
    this.working_memory = 1 // CDG mode, work on primary memory only
    this.display_memory = 1 // CDG mode, display primary memory only
    this.pixels = new Uint8ClampedArray(this.WIDTH * this.HEIGHT).fill(0)
    this.pixels_2 = new Uint8ClampedArray(this.WIDTH * this.HEIGHT).fill(0)
    this.buffer = new Uint8ClampedArray(this.WIDTH * this.HEIGHT).fill(0)
    this.imageData = new ImageData(this.WIDTH * 2, this.HEIGHT * 2)

    // informational
    this.backgroundRGBA = [0, 0, 0, 0]
    this.contentBounds = [0, 0, 0, 0] // x1, y1, x2, y2
  }

  shouldShowChannel (channel) {
    // TODO: Make this configurable
    return (channel == 0 || channel == 1)
  }

  setCLUTFromBits (index) {
    this.clut[index] = this.clut6_bits[index].map(c => c * 4)
  }

  setCLUTEntryItem1 (index, r, g, b) {
    const f = (c => c * 4 + 2)
    if (this.working_memory & 1) {
      this.clut6_bits[index] = [r, g, b].map(f)
      this.setCLUTFromBits(index)
    }
    if (this.display_memory && this.working_memory & 2) {
      const index2 = index + SECONDARY_MEMORY_CLUT_START
      this.clut6_bits[index2] = [r, g, b].map(f)
      this.setCLUTFromBits(index2)
    }
  }

  setCLUTEntryHigh4Bits (index, r, g, b) {
    if (this.display_memory == 0) {
      // Note: might be ok to just clobber the low bits?
      const old = this.clut6_bits[index]
      this.clut6_bits[index] = [r,g,b].map((c, i) => (old[i] & 0x03) | (c << 2))
      this.setCLUTFromBits(index)
    } else {
      // Note: should only be doing < 16
      // TODO: is there any difference between this and the item-1 version in 2-plane mode?
      this.setCLUTEntryItem1(index, r, g, b)
    }
  }

  setCLUTEntryLow2Bits (index, r, g, b) {
    if (this.display_memory == 0) {
      const old = this.clut6_bits[index]
      this.clut6_bits[index] = [r,g,b].map((c, i) => (old[i] & 0x3c) | c)
      this.setCLUTFromBits(index)
    } else {
      // TODO: does 2-plane mode use the low bits? It is written occasionally with all 1s.
      //console.log(`CLUT low bits set in 2-plane mode [${index}] = [${r},${g},${b}]`)
    }
  }

  mixCLUT ( index_1, index_2 ) {
    const color_1 = this.clut[index_1]
    const color_2 = this.clut[index_2]

    return color_1.map((c1, i) => {
      const c2 = color_2[i]
      const c = c1 + c2
      if (c > 255) {
        return 255
      } else {
        return c
      }
    })
  }

  renderFrame ({ forceKey = false } = {}) {
    const [left, top, right, bottom] = [0, 0, this.WIDTH, this.HEIGHT]
    let [x1, y1, x2, y2] = [this.WIDTH, this.HEIGHT, 0, 0] // content bounds
    let isContent = false

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        let colorIndex
        let colorIndex_2 = null
        if (x < this.DISPLAY_BOUNDS[0] || y < this.DISPLAY_BOUNDS[1] || x >= this.DISPLAY_BOUNDS[2] || y >= this.DISPLAY_BOUNDS[3]) {
          // Borders are always a fixed color
          // TODO: different depending on display_memory?
          colorIndex = this.borderColor
        } else {
          // Respect the horizontal and vertical offsets for grabbing the pixel color
          const px = x + this.hOffset
          const py = y + this.vOffset
          const pixelIndex = px + (py * this.WIDTH)
          const px_2 = x + this.hOffset_2
          const py_2 = y + this.vOffset_2
          const pixelIndex_2 = px_2 + (py_2 * this.WIDTH)
          if (this.display_memory == 0) {
            // 1-plane mode
            colorIndex = this.pixels[pixelIndex] | (this.pixels_2[pixelIndex_2] << 4)
          } else if (this.display_memory == 1) {
            // primary memory only
            colorIndex = this.pixels[pixelIndex]
          } else if (this.display_memory == 2) {
            // secondary memory only
            colorIndex = this.pixels_2[pixelIndex_2] + SECONDARY_MEMORY_CLUT_START
          } else if (this.display_memory == 3) {
            // mix
            colorIndex = this.pixels[pixelIndex]
            colorIndex_2 = this.pixels_2[pixelIndex_2] + SECONDARY_MEMORY_CLUT_START
          }
        }
        const [r, g, b] = (colorIndex_2 !== null) ?
            this.mixCLUT(colorIndex, colorIndex_2) :
            this.clut[colorIndex]
        // TODO this doesn't handle 2-plane mix
        const isKeyColor = colorIndex === this.keyColor ||
          (forceKey && (colorIndex === this.bgColor || this.bgColor == null))

        // Set the rgba values in the image data
        let offset = 4 * (x*2 + (y*2 * this.WIDTH * 2))
        this.imageData.data[offset] = r
        this.imageData.data[offset + 1] = g
        this.imageData.data[offset + 2] = b
        this.imageData.data[offset + 3] = isKeyColor ? 0x00 : 0xff
        this.imageData.data[offset + 4] = r
        this.imageData.data[offset + 5] = g
        this.imageData.data[offset + 6] = b
        this.imageData.data[offset + 7] = isKeyColor ? 0x00 : 0xff
        offset += 4 * this.WIDTH * 2;
        this.imageData.data[offset] = r
        this.imageData.data[offset + 1] = g
        this.imageData.data[offset + 2] = b
        this.imageData.data[offset + 3] = isKeyColor ? 0x00 : 0xff
        this.imageData.data[offset + 4] = r
        this.imageData.data[offset + 5] = g
        this.imageData.data[offset + 6] = b
        this.imageData.data[offset + 7] = isKeyColor ? 0x00 : 0xff

        // test content bounds
        if (!isKeyColor) {
          isContent = true
          if (x1 > x) x1 = x
          if (y1 > y) y1 = y
          if (x2 < x) x2 = x
          if (y2 < y) y2 = y
        }
      }
    }

    // report content bounds, with two tweaks:
    // 1) if there are no visible pixels, report [0,0,0,0] (isContent flag)
    // 2) account for size of the rightmost/bottommost pixels in 2nd coordinates (+1)
    this.contentBounds = isContent || !forceKey ? [x1, y1, x2 + 1, y2 + 1] : [0, 0, 0, 0]

    // report background status
    this.backgroundRGBA = this.bgColor === null
      ? [0, 0, 0, forceKey ? 0 : 1]
      : [...this.clut[this.bgColor], this.bgColor === this.keyColor || forceKey ? 0 : 1]
  }
}

CDGContext.prototype.WIDTH = 300
CDGContext.prototype.HEIGHT = 216
CDGContext.prototype.DISPLAY_WIDTH = 288
CDGContext.prototype.DISPLAY_HEIGHT = 192
CDGContext.prototype.DISPLAY_BOUNDS = [6, 12, 294, 204]
CDGContext.prototype.TILE_WIDTH = 6
CDGContext.prototype.TILE_HEIGHT = 12

/************************************************
* MEMORY_PRESET
************************************************/
class CDGMemoryPresetInstruction {
  constructor (bytes) {
    this.color = bytes[CDG_DATA] & 0x0F
    this.repeat = bytes[CDG_DATA + 1] & 0x0F
  }

  execute (ctx) {
    switch (ctx.working_memory) {
      case 0:
        break
      case 1:
        ctx.pixels.fill(this.color)
        break
      case 2:
        ctx.pixels_2.fill(this.color)
        break
      case 3:
        ctx.pixels.fill(this.color)
        ctx.pixels_2.fill(0)
        break
    }
    ctx.bgColor = this.color
  }
}

/************************************************
* BORDER_PRESET
************************************************/
class CDGBorderPresetInstruction {
  constructor (bytes) {
    this.color = bytes[CDG_DATA] & 0x0F
  }

  execute (ctx) {
    // TODO how should this work regarding planes?
    ctx.borderColor = this.color
  }
}

/************************************************
* TILE_BLOCK
************************************************/
class CDGTileBlockInstruction {
  constructor (bytes) {
    this.colors = [bytes[CDG_DATA] & 0x0F, bytes[CDG_DATA + 1] & 0x0F]
    this.row = bytes[CDG_DATA + 2] & 0x1F
    this.column = bytes[CDG_DATA + 3] & 0x3F
    this.pixels = bytes.slice(CDG_DATA + 4, CDG_DATA + 16)
    this.channel = ((bytes[CDG_DATA] & 0x30) >> 2) | ((bytes[CDG_DATA + 1] & 0x30) >> 4)
  }

  execute (ctx) {
    /* blit a tile */
    if (!ctx.shouldShowChannel(this.channel)) {
      return
    }
    if (ctx.working_memory == 0) {
      return
    }

    const x = this.column * ctx.TILE_WIDTH
    const y = this.row * ctx.TILE_HEIGHT

    if (x + 6 > ctx.WIDTH || y + 12 > ctx.HEIGHT) {
      //console.log(`TileBlock out of bounds (${this.row},${this.column})`)
      return
    }

    for (let i = 0; i < 12; i++) {
      const curbyte = this.pixels[i]
      for (let j = 0; j < 6; j++) {
        const color = this.colors[((curbyte >> (5 - j)) & 0x1)]
        const offset = x + j + (y + i) * ctx.WIDTH

        this.ops(ctx, offset, color)
      }
    }
  }

  ops ({ working_memory, display_memory, pixels, pixels_2 }, offset, color) {
      if (working_memory & 1) {
        this.op(pixels, offset, color)
      }
      if (display_memory != 0 && working_memory & 2) {
        this.op(pixels_2, offset, color)
      }
  }

  op (pixels, offset, color) {
    pixels[offset] = color
  }
}

/************************************************
* TILE_BLOCK_XOR
************************************************/
class CDGTileBlockXORInstruction extends CDGTileBlockInstruction {
  op (pixels, offset, color) {
    pixels[offset] = pixels[offset] ^ color
  }
}

/************************************************
* SCROLL_PRESET
************************************************/
class CDGScrollPresetInstruction {
  constructor (bytes) {
    this.color = bytes[CDG_DATA] & 0x0F

    const hScroll = bytes[CDG_DATA + 1] & 0x3F
    this.hCmd = (hScroll & 0x30) >> 4
    this.hOffset = (hScroll & 0x07)

    const vScroll = bytes[CDG_DATA + 2] & 0x3F
    this.vCmd = (vScroll & 0x30) >> 4
    this.vOffset = (vScroll & 0x0f)
  }

  execute (ctx) {
    if (ctx.working_memory == 0) {
      return
    }

    if (ctx.working_memory & 1) {
      ctx.hOffset = Math.min(this.hOffset, 5)
      ctx.vOffset = Math.min(this.vOffset, 11)
    }
    if (ctx.working_memory & 2) {
      ctx.hOffset_2 = Math.min(this.hOffset, 5)
      ctx.vOffset_2 = Math.min(this.vOffset, 11)
    }

    let hmove = 0
    if (this.hCmd === CDG_SCROLL_RIGHT) {
      hmove = ctx.TILE_WIDTH
    } else if (this.hCmd === CDG_SCROLL_LEFT) {
      hmove = -ctx.TILE_WIDTH
    }

    let vmove = 0
    if (this.vCmd === CDG_SCROLL_DOWN) {
      vmove = ctx.TILE_HEIGHT
    } else if (this.vCmd === CDG_SCROLL_UP) {
      vmove = -ctx.TILE_HEIGHT
    }

    if (hmove === 0 && vmove === 0) {
      return
    }

    if (ctx.working_memory & 1) {
      for (let x = 0; x < ctx.WIDTH; x++) {
        for (let y = 0; y < ctx.HEIGHT; y++) {
          const offx = x + hmove
          const offy = y + vmove
          ctx.buffer[x + y * ctx.WIDTH] = this.getPixel(ctx, offx, offy)
        }
      }

      {
        const tmp = ctx.pixels
        ctx.pixels = ctx.buffer
        ctx.buffer = tmp
      }
    }

    if (ctx.working_memory & 2) {
      for (let x = 0; x < ctx.WIDTH; x++) {
        for (let y = 0; y < ctx.HEIGHT; y++) {
          const offx = x + hmove
          const offy = y + vmove
          ctx.buffer[x + y * ctx.WIDTH] = this.getPixel_2(ctx, offx, offy)
        }
      }

      {
        const tmp = ctx.pixels_2
        ctx.pixels_2 = ctx.buffer
        ctx.buffer = tmp
      }
    }
  }

  getPixel ({ WIDTH, HEIGHT, pixels }, offx, offy) {
    if (offx > 0 && offx < WIDTH && offy > 0 && offy < HEIGHT) {
      return pixels[offx + offy * WIDTH]
    } else {
      return this.color
    }
  }

  getPixel_2 ({ WIDTH, HEIGHT, pixels_2, display_memory }, offx, offy) {
    if (offx > 0 && offx < WIDTH && offy > 0 && offy < HEIGHT) {
      return pixels_2[offx + offy * WIDTH]
    } else {
      if (display_memory == 0) {
        return 0
      } else {
        return this.color
      }
    }
  }
}

/************************************************
* SCROLL_COPY
************************************************/
class CDGScrollCopyInstruction extends CDGScrollPresetInstruction {
  getPixel ({ WIDTH, HEIGHT, pixels }, offx, offy) {
    offx = (offx + WIDTH) % WIDTH
    offy = (offy + HEIGHT) % HEIGHT
    return pixels[offx + offy * WIDTH]
  }

  getPixel_2 ({ WIDTH, HEIGHT, pixels_2 }, offx, offy) {
    offx = (offx + WIDTH) % WIDTH
    offy = (offy + HEIGHT) % HEIGHT
    return pixels_2[offx + offy * WIDTH]
  }
}

/************************************************
* SET_KEY_COLOR
************************************************/
class CDGSetKeyColorInstruction {
  constructor (bytes) {
    this.index = bytes[CDG_DATA] & 0x0F
  }

  execute (ctx) {
    ctx.keyColor = this.index
  }
}

/************************************************
* LOAD_CLUT_LOW
************************************************/
class CDGLoadCLUTLowInstruction {
  constructor (bytes) {
    this.colors = Array(8)

    for (let i = 0; i < 8; i++) {
      const cur = CDG_DATA + 2 * i

      let color = (bytes[cur] & 0x3F) << 6
      color += bytes[cur + 1] & 0x3F

      const rgb = Array(3)
      rgb[0] = color >> 8 // red
      rgb[1] = (color & 0xF0) >> 4 // green
      rgb[2] = color & 0xF // blue
      this.colors[i] = rgb
    }

    this.offset = 0
  }

  execute (ctx) {
    if (ctx.working_memory == 0) {
      return
    }
    for (let i = 0; i < 8; i++) {
      this.op(ctx, i)
    }
  }

  op (ctx, i) {
    ctx.setCLUTEntryItem1(i + this.offset,
        this.colors[i][0],
        this.colors[i][1],
        this.colors[i][2])
  }
}

/************************************************
* LOAD_CLUT_HI
************************************************/
class CDGLoadCLUTHighInstruction extends CDGLoadCLUTLowInstruction {
  constructor (bytes) {
    super(bytes)
    this.offset = 8
  }
}

/************************************************
* CD+EG
************************************************/

class CDEGMemoryControlInstruction {
  constructor(bytes) {
    // TODO repeated twice, is this significant?
    this.mode = bytes[CDG_DATA] & 0xf
  }

  execute (ctx) {
    const working_memory = this.mode & 3
    const display_memory = this.mode >> 2

    if (display_memory == 0 && (working_memory == 1 || working_memory == 2)) {
      // no-op
      return
    }

    /*
    if (ctx.working_memory != working_memory) {
      console.log(`working memory ${ctx.working_memory} -> ${working_memory}`)
    }
    if (ctx.display_memory != display_memory) {
      console.log(`display memory ${ctx.display_memory} -> ${display_memory}`)
    }
    */
    ctx.working_memory = working_memory
    ctx.display_memory = display_memory
  }
}

class CDEGTileBlockAdditionalInstruction extends CDGTileBlockInstruction {
  ops ({ pixels_2 }, offset, color) {
    pixels_2[offset] = color
  }
}

class CDEGTileBlockXORAdditionalInstruction extends CDGTileBlockInstruction {
  ops ({ pixels_2 }, offset, color) {
    pixels_2[offset] = pixels_2[offset] ^ color
  }
}

class CDEGLoadCLUTInstruction extends CDGLoadCLUTLowInstruction {
  constructor (bytes) {
    super(bytes)
    this.offset = ((bytes[1] & 0x3f) - CDEG_LOAD_CLUT_0) * 8
  }

  op (ctx, i) {
    ctx.setCLUTEntryHigh4Bits(i + this.offset,
        this.colors[i][0],
        this.colors[i][1],
        this.colors[i][2])
  }
}

class CDEGLoadCLUTAdditionalInstruction {
  constructor (bytes) {
    this.colors = Array(16)

    for (let i = 0; i < 16; i++) {
      const cur = CDG_DATA + i

      let color = bytes[cur] & 0x3F

      const rgb = Array(3)
      rgb[0] = color >> 4 // red
      rgb[1] = (color & 0x0c) >> 2 // green
      rgb[2] = color & 0x03 // blue
      this.colors[i] = rgb
    }

    this.offset = ((bytes[1] & 0x3f) - CDEG_LOAD_CLUT_2_0) * 16
  }

  execute (ctx) {
    for (let i = 0; i < 16; i++) {
      ctx.setCLUTEntryLow2Bits(i + this.offset,
          this.colors[i][0],
          this.colors[i][1],
          this.colors[i][2])
    }
  }
}

/************************************************
* CDGParser
************************************************/
class CDGParser {
  constructor (buffer) {
    this.bytes = new Uint8Array(buffer)
    this.numPackets = buffer.byteLength / PACKET_SIZE
    this.pc = -1
  }

  parseThrough (sec) {
    // determine packet we should be at, based on spec
    // of 4 packets per sector @ 75 sectors per second
    const newPc = Math.floor(4 * 75 * sec)
    const instructions = []

    if (this.pc > newPc) {
      // rewind kindly
      this.pc = -1
      instructions.isRestarting = true
    }

    while (this.pc < newPc && this.pc < this.numPackets) {
      this.pc++
      const offset = this.pc * PACKET_SIZE
      const cmd = this.parse(this.bytes.slice(offset, offset + PACKET_SIZE))

      // ignore no-ops
      if (cmd) instructions.push(cmd)
    }

    return instructions
  }

  parse (packet) {
    const command = packet[0] & this.COMMAND_MASK
    if (command === this.CDG_COMMAND) {
      const opcode = packet[1] & this.COMMAND_MASK
      const InstructionType = this.CDG_BY_TYPE[opcode]

      if (typeof (InstructionType) !== 'undefined') {
        return new InstructionType(packet)
      } else {
        console.log(`Unknown CDG instruction (instruction = ${opcode})`)
        return false // no-op
      }
    } else if (command === this.CDEG_COMMAND) {
      const opcode = packet[1] & this.COMMAND_MASK
      const InstructionType = this.CDEG_BY_TYPE[opcode]

      if (typeof (InstructionType) !== 'undefined') {
        return new InstructionType(packet)
      } else {
        console.log(`Unknown CDEG instruction (instruction = ${opcode})`)
        return false // no-op
      }
    }

    return false // no-op
  }
}

CDGParser.prototype.COMMAND_MASK = 0x3F
CDGParser.prototype.CDG_COMMAND = 0x9
CDGParser.prototype.CDG_BY_TYPE = {
  [CDG_MEMORY_PRESET]: CDGMemoryPresetInstruction,
  [CDG_BORDER_PRESET]: CDGBorderPresetInstruction,
  [CDG_TILE_BLOCK]: CDGTileBlockInstruction,
  [CDG_SCROLL_PRESET]: CDGScrollPresetInstruction,
  [CDG_SCROLL_COPY]: CDGScrollCopyInstruction,
  [CDG_SET_KEY_COLOR]: CDGSetKeyColorInstruction,
  [CDG_LOAD_CLUT_LOW]: CDGLoadCLUTLowInstruction,
  [CDG_LOAD_CLUT_HI]: CDGLoadCLUTHighInstruction,
  [CDG_TILE_BLOCK_XOR]: CDGTileBlockXORInstruction
}
CDGParser.prototype.CDEG_COMMAND = 0xa
CDGParser.prototype.CDEG_BY_TYPE = {
  [CDEG_MEMORY_CONTROL]: CDEGMemoryControlInstruction,
  [CDEG_TILE_BLOCK_2]: CDEGTileBlockAdditionalInstruction,
  [CDEG_TILE_BLOCK_2_XOR]: CDEGTileBlockXORAdditionalInstruction,
}

for (let i = CDEG_LOAD_CLUT_0; i <= CDEG_LOAD_CLUT_248; i++) {
  CDGParser.prototype.CDEG_BY_TYPE[i] = CDEGLoadCLUTInstruction
}
for (let i = CDEG_LOAD_CLUT_2_0; i <= CDEG_LOAD_CLUT_2_240; i++) {
  CDGParser.prototype.CDEG_BY_TYPE[i] = CDEGLoadCLUTAdditionalInstruction
}

/************************************************
* CDGPlayer
************************************************/
class CDGPlayer {
  constructor () {
    this.ctx = new CDGContext()
  }

  load (buffer) {
    if (!(buffer instanceof ArrayBuffer)) throw new Error('load() expects an ArrayBuffer')

    this.forceKey = null
    this.parser = new CDGParser(buffer)
  }

  render (time, opts = {}) {
    if (!this.parser) throw new Error('load() must be called before render()')
    if (isNaN(time) || time < 0) throw new Error(`Invalid time: ${time}`)

    const instructions = this.parser.parseThrough(time)
    const isChanged = !!instructions.length || !!instructions.isRestarting || opts.forceKey !== this.forceKey
    this.forceKey = opts.forceKey // cache last value so we re-render if it changes

    if (instructions.isRestarting) {
      this.ctx.init()
    }

    for (const i of instructions) {
      i.execute(this.ctx)
    }

    if (isChanged) {
      this.ctx.renderFrame(opts)
    }

    return {
      imageData: this.ctx.imageData,
      isChanged,
      backgroundRGBA: this.ctx.backgroundRGBA,
      contentBounds: this.ctx.contentBounds,
    }
  }
}

module.exports = CDGPlayer
