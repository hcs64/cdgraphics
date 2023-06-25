const cdgUrl = 'all.cdg'

const CDGraphics = require('../index.js')
const cdg = new CDGraphics()

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app')
  const audio = document.getElementById('audio')
  const canvas = document.getElementById('canvas')
  canvas.width = 300*2
  canvas.height = 216*2

  const ctx = canvas.getContext('2d')
  let frameId

  const doRender = time => {
    const frame = cdg.render(time, { forceKey: false })
    if (!frame.isChanged) return

    createImageBitmap(frame.imageData)
      .then(bitmap => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      })
  }

  // render loop
  const pause = () => cancelAnimationFrame(frameId)
  const play = () => {
    frameId = requestAnimationFrame(play)
    doRender(audio.currentTime)
  }

  // event handlers for track seek
  const tracks = document.getElementById('track-list')
  for (track of tracks.getElementsByClassName('track')) {
    if (track.dataset && 'seek' in track.dataset) {
      let [mm, ss, ff] = track.dataset.seek.split(":").map(n => parseInt(n, 10))
      let seek_time = (mm * 60 + ss) + ff / 75
      track.addEventListener('click', () => {
        audio.currentTime = seek_time
        audio.play()
      })
    }
  }

  // download and load cdg file
  fetch(cdgUrl)
    .then(response => response.arrayBuffer())
    .then(buffer => {
      app.classList.remove('loading-cdg')
      cdg.load(buffer)

      if (audio.paused) {
        pause()
      } else {
        play()
      }

      // follow audio events (depending on your app, not all are strictly necessary)
      audio.addEventListener('play', play)
      audio.addEventListener('pause', pause)
      audio.addEventListener('ended', pause)
      audio.addEventListener('seeked', () => doRender(audio.currentTime))
    })
})
