# vlc-rc-socket

Simple module to control VLC player using a Unix socket.


## Installation

```bash
$ npm install vlc-rc-socket
```
The following shall be done once to enable and configure VLC Player RC Interface before start:

in *Preferences > Interface > Main Interfaces* check *Remote control interface*

in *Preferences > Interface > Main Interfaces > RC* check *fake TTY* and set path to socket file in *UNIX socket command input* field.

Make sure that VLC player has permissions to make and write files in this directory.



## Examples

```js
  //Getting started
  var vlc = require('vlc-rc-socket');

  vlcPlayer = new vlc.VlcPlayer();
  vlcPlayer.socketFile = 'vlc.sock';  //path to socket file
  vlcPlayer.autoRestore = true;       //reopen file if VLC player was crashed

  vlcPlayer
    .on('open', function(pid) {
      console.log('VLC player PID: ', this.vlcPID);
    })

    .on('err', function(err){
      console.log(err);
    })

    .on('state_change', function(stateInfo){
      // stateInfo object contains state name and info about opened media file

      console.log(vlcPlayer.currentState);
      console.log(stateInfo);
    })

    .on('close', function(code) {
      console.log('vlc was closed. Exit  code: ', code);
    });

  //Run VLC player. Argument - string to run VLC player from a command shell
  vlcPlayer.startVLC('/usr/bin/vlc');
```

### States

module has 4 states:

    - 'playerStarting': module executed command to run VLC player ('/usr/bin/vlc') and waits for VLC player to get started;
    - 'stopped': no media file is opened;
    - 'tryingToOpenFile': module sent openFile command to VLC player and waits for response;
    - 'playing': media file is opened.




## License

[MIT](LICENSE)