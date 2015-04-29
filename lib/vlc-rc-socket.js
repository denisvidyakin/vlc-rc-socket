var util = require('util')
var spawn = require('child_process').spawn
var exec = require('child_process').exec
var EventEmitter = require('events').EventEmitter

function VlcPlayer(opts) {
  if (!(this instanceof VlcPlayer)) return new VlcPlayer(opts)

  EventEmitter.call(this)

  opts = opts || {}

  this.error = null
  this.vlcPID = 'unknown'
  this.vlc = null
  this.vlcCommand = null
  this.autoRestore = false
  this._reopenTimer = null
  this.openedFile = ''
  this._fileToOpen = ''
  this.mediaInfo = {}
  this.mediaStreamLength = '0'
  this._mediaInfoIntervalUpdater = null
  this._commandsQueie = []
  this._nextCommandInterval = null
  this._autoStartNextCommand = true
  this._allowNewConnections = true
  this.socketFile = ''
  this.currentState = 'playerStarting'          // tryingToOpenFile, playing, stopped
  this._currentStateObj = {'s': 'playerStarting'}

  return this;
}

util.inherits(VlcPlayer, EventEmitter)
exports.VlcPlayer = VlcPlayer

VlcPlayer.prototype.startVLC = function (vlcOpenCommand, cb) {
  // Setup callback
  if (cb) {
    this
      .on('player_open', function (pid) {
      cb(null, pid)
    })
      .on('error', function (err) {
      cb(err)
    })
  }

  var self = this
  var vlcCommand = vlcOpenCommand || this.vlcCommand


  this._killExistingVlcInstances(vlcCommand, function (err, result) {
    self._startVLC(vlcCommand)
  })
}

VlcPlayer.prototype._restartVlc = function () {
  var self = this
  this._killExistingVlcInstances(this.vlcCommand, function (err, result) {
    self._startVLC(self.vlcCommand)
  });
}

VlcPlayer.prototype._killExistingVlcInstances = function (vlcOpenCommand, cb) {
  var killal = exec('killall ' + vlcOpenCommand, function (error, stdout, stderr) {
    if (cb) cb(stderr, stdout)
  });
}

VlcPlayer.prototype._startVLC = function (vlcOpenCommand) {
  this._setState('playerStarting')
  this.vlc = spawn(vlcOpenCommand)

  this.vlcCommand = vlcOpenCommand
  this._onVlcOpen(this.vlc.pid)

  this.vlc.stdout.on('data', function (data) {
    //console.log('stdout: ' + data)
  })

  this.vlc.stderr.on('data', function (data) {
    //console.log('stderr: ' + data);
  })

  this.vlc.on('close', function (code) {
    this._onVlcClose(code)
  }.bind(this))
}

VlcPlayer.prototype._onVlcOpen = function (pid) {
  this.vlcPID = pid
  this._setState('stopped')
  this.emit('player_open', this.vlcPID)
  if (this.autoRestore) {
    this._tryReopenLastFile();
  }
}

VlcPlayer.prototype._onVlcClose = function (code) {
  this._sendCommand('stopped')
  this._setState('playerStarting')
  if (this.autoRestore) {
    this._restartVlc()
  }
  this.emit('close', code)
}

VlcPlayer.prototype._tryReopenLastFile = function () {
  var mediaPath = ''
  var self = this
  if (this.openedFile != '') {
    mediaPath = this.openedFile
  } else if (this._fileToOpen != '') {
    mediaPath = this._fileToOpen
  }

  if (mediaPath != '') {
    this._reopenTimer = setTimeout(function () {
      self.openMedia(mediaPath)
    }, 2000)
  }
}


/* -------- RC COMMANDS -------- */

VlcPlayer.prototype.openMedia = function (mediaPath, cb) {
  this._clearCommandQueie()
  this.openedFile = ''
  this._fileToOpen = mediaPath
  this._setState('tryingToOpenFile')

  this._openMedia(mediaPath, cb)
}

VlcPlayer.prototype._openMedia = function (mediaPath, cb) {
  var cmd = 'add \'' + mediaPath + '\''
  var self = this
  this.addCommand(cmd, function (err, openResult) {
    if (self._openMediaCommandIsExecutedProperly(openResult) || err) {
      self.openedFile = mediaPath
      self._startMediaInfoIntervalUpdate(900, cb)
    } else {
      if (cb) cb(new Error('Error: can\'t open ' + mediaPath, openResult) )
    }
  });
}

VlcPlayer.prototype._openMediaCommandIsExecutedProperly = function (answer) {
  if (answer.indexOf('\nadd: returned 0 (no error)') > -1) {
    return true
  } else {
    return false
  }
}

VlcPlayer.prototype.addCommand = function (commandStr, cb) {
  this._commandsQueie.push({'commandStr': commandStr, 'cb': cb})

  if (this._commandsQueie.length == 1) {
    this._tryExecuteNextCommand()
  }
}

VlcPlayer.prototype._tryExecuteNextCommand = function () {
  if (this._mayExecuteNextCommand()) {                        //start next command immediately
    this._nextCommand()
  } else {
    this._startNextCommandWaiting()                         //interval checking to start new command
  }
}

VlcPlayer.prototype._nextCommand = function () {
  if (this._commandsQueie.length > 0) {
    var curCommand = this._commandsQueie.shift()
    var commandStr = curCommand.commandStr
    var cb = curCommand.cb || null

    this._sendCommand(commandStr, cb)
  }
}

VlcPlayer.prototype._startNextCommandWaiting = function (updateInterval) {
  var interval = updateInterval || 300
  var self = this

  if (this._nextCommandInterval) {
    clearInterval(this._nextCommandInterval)
  }

  this._autoStartNextCommand = false
  this._nextCommandInterval = setInterval(function () {
    if (self._mayExecuteNextCommand()) {
      clearInterval(this._nextCommandInterval)
      self._autoStartNextCommand = true
      self._nextCommand()
    }
  }, interval);
}

VlcPlayer.prototype._clearCommandQueie = function () {
  if (this._mediaInfoIntervalUpdater)   clearInterval(this._mediaInfoIntervalUpdater)
  if (this._nextCommandInterval)        clearInterval(this._nextCommandInterval)
  if (this._reopenTimer)                clearTimeout(this._reopenTimer)

  this._commandsQueie = []
}

VlcPlayer.prototype._mayExecuteNextCommand = function () {
  var res = false

  if (this._allowNewConnections) {
    //if currentState is 'tryingToOpenFile' - only 'add' command may execute;
    if (this.currentState == 'tryingToOpenFile') {
      if (this._commandsQueie.length > 0) {
        if (this._commandsQueie[0].commandStr.indexOf('add ') == 0) {
          res = true
        }
      }
    }
    else if (this.currentState == 'playing') {
      res = true
    }
  }

  return res
}

VlcPlayer.prototype._sendCommand = function (commandStr, cb) {
  var cmd = '/bin/echo "' + commandStr + '" | nc -U -t ' + this.socketFile
  var self = this
  console.log('currentCommand:\n', commandStr)

  this._allowNewConnections = false
  var child = exec(cmd, function (error, stdout, stderr) {
    if (cb) {
      cb(stderr, stdout)
    }

    self._allowNewConnections = true

    if (self._autoStartNextCommand) {
      self._tryExecuteNextCommand()
    }
  })
}


VlcPlayer.prototype.getMediaInfo = function () {
  var res = {'mediaInfoStr': 'no media'}
  if (this.currentState == 'playing') {
    res = this.mediaInfo
  }
  return res
}

VlcPlayer.prototype._startMediaInfoIntervalUpdate = function (interval, cb) {
  var self = this
  var updateInterval = interval || 1000

  if (this._mediaInfoIntervalUpdater) {
    clearInterval(this._mediaInfoIntervalUpdater)
  }

  this._mediaInfoIntervalUpdater = setInterval(function () {
    if (self._allowNewConnections) {
      self._sendCommand('info', function (err, mediaInfoStr) {
        self._tryToStopMediaInfoIntervalUpdate(err, mediaInfoStr, cb)
      })
    }
  }, updateInterval)
}

VlcPlayer.prototype._tryToStopMediaInfoIntervalUpdate = function (err, mediaInfoStr, cb) {
  if (!err) {
    if (this._mediaInfoIsValid(mediaInfoStr) || this.currentState != 'tryingToOpenFile') {
      this._stopMediaInfoIntervalUpdate()
      this.mediaInfo = this._convertMediaInfoStrToObj(mediaInfoStr)
      var self = this
      this._getStreamLength(function (streamLength) {
        self.mediaInfo.streamLength = streamLength
        self.mediaStreamLength = parseInt(streamLength, 10)
        self._setState('playing')
        if (cb) cb(null, self.mediaInfo)
      })
    }
  } else {
    if (this._isBrokenPipeError(err)) {
      this._killExistingVlcInstances(this.vlcCommand)

    } else {
      this._stopMediaInfoIntervalUpdate()
      this._setState('stopped')
      if (cb) cb(err)
    }
  }
}

VlcPlayer.prototype._isBrokenPipeError = function (err) {
  if (err.indexOf('write error: Broken pipe')) {
    return true
  } else {
    return false
  }
}

VlcPlayer.prototype._stopMediaInfoIntervalUpdate = function () {
  if (this._mediaInfoIntervalUpdater) clearInterval(this._mediaInfoIntervalUpdater)
}

VlcPlayer.prototype._mediaInfoIsValid = function (mediaInfoStr) {
  var res = false
  if (mediaInfoStr.indexOf('+----[ Stream 0 ]') > -1 && mediaInfoStr.indexOf('+----[ end of stream info ]') > 16) {
    res = true
  }
  return res
}

VlcPlayer.prototype._convertMediaInfoStrToObj = function (mediaInfoStr) {
  var mediaInfoObj = {'video': [], 'audio': [], 'subtitles': [], 'unknown': []}

  var splittedArr = mediaInfoStr.split('\n')

  var curStreamObj = {'streamIndex': 0, 'mediaProperties': []}
  var curStreamType = 'unknown'
  var curStreamIndex = 0
  var curPropertyName = ''
  var curPropertyValue = ''
  var colonIndex = -1

  splittedArr.shift()

  splittedArr.forEach(function (str) {
    if (str.charAt(0) == '+') {                             // this string is start of new stream or end of streams
      curStreamIndex++;
      mediaInfoObj[curStreamType].push(curStreamObj);
      curStreamObj = {'streamIndex': curStreamIndex, 'mediaProperties': []}
      curStreamType = 'unknown'
    } else if (str.charAt(0) == '|' && str.length > 4 && str.indexOf(':') > -1) {        // this string is property
      colonIndex = str.indexOf(':')
      curPropertyName = str.substring(2, colonIndex)
      curPropertyValue = str.substr(colonIndex + 2).trim()

      switch (curPropertyName) {
        case 'Type':
          curStreamObj.type = curPropertyValue;
          switch (curPropertyValue) {
            case 'Video':
              curStreamType = 'video';
              break
            case 'Audio':
              curStreamType = 'audio';
              break
            case 'Subtitle':
              curStreamType = 'subtitles';
              break
            default:
              curStreamType = 'unknown'
          }
          break
        case 'Language':
          curStreamObj.language = curPropertyValue;
          break
        case 'Description':
          curStreamObj.description = curPropertyValue;
          break
        default:
          curStreamObj.mediaProperties.push({'name': curPropertyName, 'val': curPropertyValue})
      }
    }
  })

  mediaInfoObj.mediaInfoStr = mediaInfoStr

  return mediaInfoObj
}

VlcPlayer.prototype._getStreamLength = function (cb) {
  this._sendCommand('get_length', function (err, streamLength) {
    if (!err) {
      if (cb) cb(streamLength.trim())
    } else {
      if (cb) cb('1');
    }
  });
}


/* ----- STATES ----- */
VlcPlayer.prototype._setState = function (stateName) {
  var stateObj = {}
  switch (stateName) {
    case 'playerStarting':
      stateObj = this._setPlayerStartingState();
      break
    case 'stopped':
      stateObj = this._setStoppedState();
      break
    case 'tryingToOpenFile':
      stateObj = this._setTryingToOpenFileState();
      break
    case 'playing':
      stateObj = this._setPlayingState();
      break
    default:
      stateObj = this._setStoppedState();
  }

  this._currentStateObj = stateObj
  this.emit('state_change', stateObj)
}


VlcPlayer.prototype._setPlayerStartingState = function () {
  this.currentState = 'playerStarting'
  return {'s': 'playerStarting'}
}

VlcPlayer.prototype._setStoppedState = function () {
  this.currentState = 'stopped'
  return {'s': 'stopped'}
}

VlcPlayer.prototype._setTryingToOpenFileState = function () {
  this.currentState = 'tryingToOpenFile'
  return {'s': 'tryingToOpenFile', 'f': this._fileToOpen}
}

VlcPlayer.prototype._setPlayingState = function () {
  this.currentState = 'playing'
  return {'s': 'playing', 'f': this.openedFile, 'mi': this.mediaInfo}
}

VlcPlayer.prototype.getCurrentState = function () {
  return JSON.parse(JSON.stringify(this._currentStateObj));
}
