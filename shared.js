/*
 *  Mario Sequencer Web edition
 *    Programmed by minghai (http://github.com/minghai)
 */

// First, check the parameters to get MAGNIFY
var OPTS = {};
window.location.search.substr(1).split('&').forEach(function (s) {
  var tmp = s.split('=');
  OPTS[tmp[0]] = tmp[1];
});

// MIDI init:
//   Make global variable MIDIIN and MIDIOUT for playing NSX-39
MIDIIN  = null;
MIDIOUT = null;
navigator.requestMIDIAccess({sysex:true}).then(function(midiAccess) {
  var ins  = midiAccess.inputs();
  var outs = midiAccess.outputs();
  for (var i = 0; i < outs.length; i++) {
    if (outs[i].name.substr(0, 6) == "NSX-39") {
      MIDIOUT = outs[i];
      MIDIOUT.stopAll = function () {
        // This sysex looks easier,
        //   this.send([0xF0,0x43,0x79,9,0x11,0x0D,0x0A,7,0,0,0xF7]);
        // but it requires long time pause to start play again
        for (var i = 0; i < 16; ++i)
        {
          var msg = [0xB0 | i, 0x79, 0x00];
          this.send(msg);

          var msg = [0xB0 | i, 0x78, 0x00];
          this.send(msg);

          var msg = [0xB0 | i, 0x7B, 0x00];
          this.send(msg);
        }
      };
    }
  }
  for (var i = 0; i < ins.length; i++) {
    if (ins[i].name.substr(0, 6) == "NSX-39") {
      MIDIIN = ins[i];
      MIDIIN.onmidimessage = function (event) {
        var str = "MIDI message received at timestamp " + event.timestamp + "[" + event.data.length + " bytes]: ";
        for (var i=0; i<event.data.length; i++) {
          str += "0x" + event.data[i].toString(16) + " ";
        }
        console.log( str );
      };
    }
  }
  if (MIDIOUT == null || MIDIIN == null) {
    throw Error("POKEMIKU NOT FOUND");
    console.log("POKEMIKU NOT FOUND");
    console.log("This program needs YAMAHA NSX-39.");
  }
}, function (err) {
  alert("PokeMiku not found:" + err);
  console.log("PokeMiku not found:" + err);
})
.catch(function (err) {
  alert("Can't use MIDI:" + err);
  console.log("Can't use MIDI:" + err);
});

// GLOBAL VARIABLES
//   Constants: Full capital letters
//   Variables: CamelCase
AC = (window.AudioContext) ? new AudioContext() : new webkitAudioContext();
SEMITONERATIO = Math.pow(2, 1/12);
MAGNIFY = OPTS.mag || OPTS.magnify || 2;
CHARSIZE = 16 * MAGNIFY;
HALFCHARSIZE = Math.floor(CHARSIZE / 2);
BUTTONS = [];
ENDMARKIDX = -1;
ERASERIDX  = -2;
MouseX = 0;
MouseY = 0;
CONSOLE = document.getElementById("console");
ORGWIDTH  = 256;
ORGHEIGHT = 224;
SCRHEIGHT = 152;
CONSOLE.style.width  = ORGWIDTH  * MAGNIFY + "px";
CONSOLE.style.height = ORGHEIGHT * MAGNIFY + "px";
OFFSETLEFT = CONSOLE.offsetLeft;
OFFSETTOP  = CONSOLE.offsetTop;
CurChar = 0; // Index of SOUNDS(!)
CurPos = 0;
CurSong = undefined; // For Embedded Songs
CurScore = {};
Runner = null; // Keeps current runner
DEFAULTMAXBARS = 24 * 4 + 1; // 24 bars by default
DEFAULTTEMPO = 100;
CurMaxBars = DEFAULTMAXBARS;
Mario = null; // Mamma Mia!
Miku  = null; // I'll make you Mikku Miku!
AnimeID = 0; // ID for cancel animation
PsedoSheet = null // CSSRules for manipulating pseudo elements
RepeatMark = null // For Score
EndMark    = null
SysSnd = {}; // System Sounds
NoteLen = undefined; // Note Length images
MikuMemo = []; // Memoize of the number of Miku notes for a bar number

// How can you say OFFSETLEFT and TOP are constant?
window.onresize = function(e) {
  OFFSETLEFT = CONSOLE.offsetLeft;
  OFFSETTOP  = CONSOLE.offsetTop;
}

/*
 * GameStatus: Game mode
 *   0: Edit
 *   1: Mario Entering
 *   2: Playing
 *   3: Mario Leaving
 *   4: Test play
 */
GameStatus = 0;

// shim layer with setTimeout fallback
window.requestAnimFrame = (function(){
return  window.requestAnimationFrame ||
  window.webkitRequestAnimationFrame ||
  window.mozRequestAnimationFrame    ||
  window.oRequestAnimationFrame      ||
  window.msRequestAnimationFrame     ||
  function( callback ){
  window.setTimeout(callback, 1000 / 60);
};
})();

// SoundEntity#constructor
function SoundEntity(path) {
  this.path = path;
  this.buffer = null;
  this.prevChord = [];
  this.diff = [14, 12, 11, 9, 7, 6, 4, 2, 0, -1, -3, -5, -6];
}

// SoundEntity#play
// The all wav files are recorded in the tone F (= 65 in midi context).
// You should choose correct playback rate to play a music.
SoundEntity.prototype.play = function(scale, delay) {
  var source = AC.createBufferSource();
  var semitone = scale - 65; // WAV is F
  if (delay == undefined) delay = 0;
  source.buffer = this.buffer;
  source.playbackRate.value = Math.pow(SEMITONERATIO, semitone);
  source.connect(AC.destination);
  source.start(delay);
};

// Play a chord
//   In fact, can be a single note.
//   Purpose is to cancel the sounds in previous bar
//   if the kind of note is the same.
//   Even the chord will be canceled (stoped) playing
//   SNES has channels limit, so that succesive notes
//   cancels previous note when next note comes.
//   Long note like Yoshi can be canceled often
//   BufferSource.stop won't throw an error even if the
//   previous note has already ended.
SoundEntity.prototype.playChord = function(noteList, delay) {
  // Cancel previous chord first
  for (var i = 0; i < this.prevChord.length; i++) {
    this.prevChord[i].stop();
  }
  this.prevChord = [];
  if (delay == undefined) delay = 0;
  // I heard that Array#map is slower than for loop because of costs of calling methods.
  for (var i = 0; i < noteList.length; i++) {
    var source = AC.createBufferSource();
    var key = noteList[i];
    var semitone = key - 65;
    source.buffer = this.buffer;
    source.playbackRate.value = Math.pow(SEMITONERATIO, semitone);

    // Compressor: Suppress harsh distortions
    //var compressor = AC.createDynamicsCompressor();
    //source.connect(compressor);
    //compressor.connect(AC.destination);
    source.connect(AC.destination);
    source.start(delay);
    this.prevChord.push(source);
  }
}

SoundEntity.prototype.load = function() {
  var filepath = this.path;
  return new Promise(function (resolve, reject) {
    // Load buffer asynchronously
    var request = new XMLHttpRequest();
    request.open("GET", filepath, true);
    request.responseType = "arraybuffer";

    request.onload = function() {
      // Asynchronously decode the audio file data in request.response
      AC.decodeAudioData(
        request.response,
        function(buffer) {
          if (!buffer) {
            reject('error decoding file data: ' + url);
          }
          resolve(buffer);
        },
        function(error) {
          reject('decodeAudioData error:' + error);
        }
      );
    }

    request.onerror = function() {
      reject('BufferLoader: XHR error');
    }

    request.send();
  });
};


function isEbony(key) {
  ebony = [false, true, false, true, false, false, true, false, true,
           false, true, false];
  return ebony[key % 12];
}

// Encode Note
//   Encode parameters into 2 bytes length binary number.
//   gridY: position in Y
//   program: Instrument number
//   isFlat: If user specified the note needs flat symbol
//           MIDI note number can contain ebony key on the piano
//           but ebony can be expressed with both sharp and flat on the score
//           In this data format, if isEbony is True and isFlat is true,
//           then the note is expressed with flat symbol.
//           Otherwise, the note is expressed with sharp symbol.
//   length: Musical note length
//           0 is infinity.
//           1 is key off. Just stop the note if the key is on
//           2 is 0.5 for staccart
//           3 is 1 (You should not use this if note succeeds other note)
//           others can be added, but I believe there's no requirement.
function encodeNote(gridY, program, isSharp, isFlat, length) {
  var interval = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20];
  if (isSharp == undefined) isSharp = false;
  if (isFlat  == undefined) isFlat  = false;
  key = 79 - interval[gridY];

  if      (isSharp) {key++; isFlat = 0}
  else if (isFlat ) {key--; isFlat = 1}
  else                      isFlat = 0;

  if (length == undefined) length = 0;
  // Todo: Decide how to encode note length
  return (length << 13 | program << 8 | (isFlat << 7) | key);
}

// ReEncode Note:
//   When you change length or octave of notes,
//  you already have MIDI key so you can't use encodeNote again.
function reencodeNote(key, program, isFlat, length) {
  return (length << 13 | program << 8 | isFlat << 7 | key);
}

// Decode Note
// return these values as an array
//   Program
//   key
//   isFlat
//   length
function decodeNote(note) {
  var key = (note & 0x7F);
  var isFlat = (note & 0x80) != 0
  var upper = (note >> 8);
  var program = upper & 0x1F;
  var length = upper >> 5;
  return [program, key, isFlat, length];
}

// ToDo: Handle Octave changes
//   Key: Key part only in Note (< 0x7F)
//   isFlat: boolean
function key2GridY(note, isFlat) {
  //var nTable = [6, 6, 5, 4, 4, 3, 3, 2, 1, 1, 0, 0];
  var nTable = [4, 4, 3, 3, 2, 1, 1, 0, 0, 6, 6, 5];
  //var sTable = [12, 11, 11, 10, 10, 9, 8, 8, 7, 7, 6, 6];
  var sTable = [11, 11, 10, 10, 9, 8, 8, 7, 7, 6, 6, 12];
  var key = (note & 0x7F);
  var doremi = key % 12;
  var gridY;
  if (key > 69) {
    gridY = nTable[doremi];
  } else if (key <= 69) {
    gridY = sTable[doremi];
  }
  if (isFlat) {
    if (doremi == 10 && key <= 59) gridY = 12; //Bb (A#) jumps 6 to 12
    else gridY--;
  }
  return gridY;
}

// Unicode to Hiragana img table
//   Change Unicode - U+3041 to the index of Hiragana images.
//   Note that some characters such as KyuKana (Old Kana) is not supported.
//   I fear if Mac returns unnormalised unicode, this will fail...
//   (Macintosh is always the seed of Unicode hell. Though Win has other problems.)
//   (Using Japanese in English world (computer) is always like going to hell...)
//  Refer: http://en.wikipedia.org/wiki/Hiragana_(Unicode_block)
Uni2Hira = [
  55,    0,   56,    1,   57,    2,   58,    3,   59,    4, // あ行
   5, 0x45,    6, 0x46,    7, 0x47,    8, 0x48,    9, 0x49, // か行
  10, 0x4A,   11, 0x4B,   12, 0x4C,   13, 0x4D,   14, 0x4E, // さ行
  15, 0x4F,   16, 0x50,   53,   17, 0x51,   18, 0x52,   19, 0x53, // た行 (with small つ)
  20,   21,   22,   23,   24, // な行
  25, 0x59, 0x99,   26, 0x5A, 0x9A, 27, 0x5B, 0x9B, 28, 0x5C, 0x9C, 29, 0x5D, 0x9D, // はばぱ
  30,   31,   32,   33,   34, // ま行
  50, 35, 51, 36, 52, 37, // ゃやゅゆょよ
  40, 41, 42, 43, 44, undefined, 45, // ら行 + わ
  undefined, undefined, 46, 47 // をん
];

// Make Char to number table for NSX-39
PhoneticSymbols = [
"あ", "い", "う", "え", "お", "か", "き", "く", "け", "こ",
"が", "ぎ", "ぐ", "げ", "ご", "きゃ", "きゅ", "きょ",
"ぎゃ", "ぎゅ", "ぎょ", "さ", "すぃ", "す", "せ", "そ",
"ざ", "ずぃ", "ず", "ぜ", "ぞ", "しゃ", "し", "しゅ", "しぇ", "しょ",
"じゃ", "じ", "じゅ", "じぇ", "じょ", "た", "てぃ", "とぅ", "て", "と",
"だ", "でぃ", "どぅ", "で", "ど", "てゅ", "でゅ",
"ちゃ", "ち", "ちゅ", "ちぇ", "ちょ", "つぁ", "つぃ", "つ", "つぇ", "つぉ",
"な", "に", "ぬ", "ね", "の", "にゃ", "にゅ", "にょ",
"は", "ひ", "ふ", "へ", "ほ", "ば", "び", "ぶ", "べ", "ぼ",
"ぱ", "ぴ", "ぷ", "ぺ", "ぽ",
"ひゃ", "ひゅ", "ひょ",
"びゃ", "びゅ", "びょ",
"ぴゃ", "ぴゅ", "ぴょ",
"ふぁ", "ふぃ", "ふゅ", "ふぇ", "ふぉ",
"ま", "み", "む", "め", "も",
"みゃ", "みゅ", "みょ",
"や", "ゆ", "よ",
"ら", "り", "る", "れ", "ろ",
"りゃ", "りゅ", "りょ", "わ", "うぃ", "うぇ", "うぉ",
"ん\\", "んm", "ん", "んj", "んn"
];
PhoneticSymbols = PhoneticSymbols.reduce(function (o, v, i) {
  o[v] = i;
  return o;
}, {});

MikuEntity = new SoundEntity();
// MikuEntity.doremi = [0x32, 0x72, 0x65, 0x5F, 0x19, 0x6F, 0x16];
MikuEntity.doremi = [0x32, 0x32, 0x72, 0x72, 0x65, 0x5F, 0x5F, 0x19, 0x19, 0x6F, 0x6F, 0x16];
MikuEntity.doremiMode = true;
MikuEntity.commands = [];
MikuEntity.prevKey = 0;
MikuEntity.prevChar = "";
MikuEntity.load = function() { // To avoid load error
  return Promise.resolve();
}
MikuEntity.play = function(key, delay) {
  if (delay == undefined) delay = 0;
  var len = key >> 8;
  key = key & 0x7F;
  var velocity = 0x7F;


  // Once before, I put key-off prevKey here.
  // But it sounds terrible. So don't do it again!
  // Even sending KeyOff and KeyOn sequencially don't work.

  if (len == 1) velocity = 0;

  // Reset counters if they over the limit (when it loops, etc.)
  if (this.slot != undefined
      && (this.idxL >= this.slot.length || this.slot[this.idxL] == 0)) {
    console.log("Lyrics rewinded to the top");
    this.idxL = 0;
    this.curSlot = 1;
    this.numOfChars = 0;
    this.changeSlot(1);
  } else if (this.numOfChars >= 64) {
    this.numOfChars = 0;
    this.changeSlot(++this.curSlot);
  }
  if (this.slot == undefined || this.doremiMode) {
    var ps = this.doremi[key % 12];
    MIDIOUT.send([0xF0,0x43,0x79,0x09,0x11,0x0A,0x00, ps,0xF7, 0x80, key, 0x7F]);
    var num = 1;
  } else {
    var letter = this.slot[this.idxL];
    var ls = letter.split('|');
    var num = ls.length;

    // If prevChar == curChar and they're not vowel, key off first to stop concat sounds
    var code = letter.charCodeAt(0);
    if (this.prevChar == ls[0] && (code < 0x3041 || code > 0x304A)) {
      MIDIOUT.send([0x80, this.prevKey, 0x7F]);
    }
  }

  // If there're multiple characters, divide one note
  var oneNoteTime = 60 / CurScore.tempo * 1000;
  var oneCharTime = oneNoteTime / num;
  var curTime = window.performance.now();
  //this.sendNextChar();
  for (var i = 0; i < num; i++) {
    MIDIOUT.send([0x90, key, velocity], curTime + oneCharTime * i);
  }

  if (len == 2)
    MIDIOUT.send([0x80, key, 0x3F], curTime + oneNoteTime * 0.5);
  else if (this.doremiMode && GameStatus == 0)
    MIDIOUT.send([0x80, key, 0x3F], curTime + 500);

  if (!this.doremiMode) {
    this.prevChar = letter;
    this.prevKey = key;
  }

  // Count and Change Slot
  //   Unfortunately, PokeMiku won't do this for you!
  if (len != 1) {
    this.idxL += 1; // No need to use num cause even one bar has many chars, they all are in the one
    this.numOfChars += num;
  }
};
MikuEntity.playChord = function(noteList, delay) {
  this.play(noteList[0], 0);
};
MikuEntity.initLyric = function(fn) {
  // idxL is a counter for whole lyrics, numOfChars is a counter for each of slots
  this.idxL = 0; // Specify Nth character to sing
  this.curSlot = 1; // Specify current lyric slot (1-F)
  this.numOfChars = 0;; // Hold the number of chars sent to MIDI (MAX = 63)


  var curLyric = document.getElementById("lyric").value;
  if (curLyric == undefined || curLyric == "") {
    this.Lyric = curLyric;
    this.doremiMode = true;
    fn();
  } else if (curLyric === this.lyric) {
    this.doremiMode = false;
    this.changeSlot(1);
    fn();
  } else {
    this.lyric = curLyric;
    this.doremiMode = false;
    console.log("Lyric Length = " + this.lyric.length);
    this.sendThemAll(fn);
  }
};
MikuEntity.sendNextChar = function () {
  var letter;
  this.off_flag = false;

  if (this.idxL >= this.lyric.length) this.idxL = 0;
  letter = this.lyric[this.idxL++];
  var n = this.lyric[this.idxL];
  var nc = n.charCodeAt(0);
  // If the next char is one of "ぁぃぅぇぉゃゅょ"
  if (((nc >= 0x3041) && (nc <= 0x3049) || (nc >= 0x3083 && nc <= 0x3087)) &&
        nc & 1 == 1) {
    letter += n;
    this.idxL++;
  } else if (n == "\n") {
    this.off_flag = true;
    this.idxL++;
  }
  console.log(letter);
  letter = PhoneticSymbols[letter];
  MIDIOUT.send([0xF0,0x43,0x79,0x09,0x11,0x0A,0x00,letter,0xF7]);
}
MikuEntity.parseLyrics = function () {

  // Get Next Letter:
  //   Result is an array of one display letter and one phonetic symbol.
  //   WARNING: I don't have English native tongue.
  //   I already am regretting about how I used 's' for plural
  function getNextLetter(lyric, idxL) {
      var letter = lyric[idxL++];
      while (letter == '\n') letter = lyric[idxL++];
      if (letter == undefined) return [0, 0];

      var n  = lyric[idxL];
      var nc = (n == undefined) ? '\0' : n.charCodeAt(0);

      // If the next char is one of "ぁぃぅぇぉゃゅょ"
      if (((nc >= 0x3041) && (nc <= 0x3049) || (nc >= 0x3083 && nc <= 0x3087)) &&
            nc & 1 == 1) {
        letter += n;
        idxL++;
      } else if (n == "\n") { // Ignore new line or EOF
        idxL++;
      } else if (n == '\0') return [0, 0];

      console.log(letter);
      var tmp = letter;
      if (tmp == "づ") tmp = "どぅ";
      else if (tmp == "を") tmp = "うぉ";
      var p = PhoneticSymbols[tmp];
      if (p == undefined) {
        console.log("    is not in PS table");
      }
      return [letter, p, idxL];
  }

  // parse:
  //   Parse Lyrics under the mode. Calls itself inside recursively.
  //   results is an array which includes phonectic symbols code
  //   letters is an array which includes letters for displaying
  function parseNormal(lyrics, results, letters) {
    var idxL = 0;
    OUTER: while (idxL < lyrics.length) {
      var lr = getNextLetter(lyrics, idxL);
      idxL = lr[2];
      var one = lr[0];
      switch (one) {
      case '\0':
        break OUTER;
      case '(':
        idxL += parseRound(lyrics.substr(idxL), results, letters);
        break;
      case '{':
        idxL += parseCurly(lyrics.substr(idxL), results, letters);
        break;
      case ')':
        throw Error("Found round blacket without open one at " + idxL);
      case '}':
        throw Error("Found curly blacket without open one at " + idxL);
      default:
        letters.push(one);
        results.push(lr[1]);
      }
    }
    return idxL;
  }

  function parseRound(lyrics, results, letters) {
    var idxL = 0;
    var letter = "";
    OUTER: while (idxL < lyrics.length) {
      var lr = getNextLetter(lyrics, idxL);
      idxL = lr[2];
      var one = lr[0];
      switch (one) {
      case '\0':
        throw Error("Round bracket was not closed until the End of Lyrics");
      case '(':
        throw Error("Found recursive round bracket at " + idxL + " in " + lyrics);
      case '{':
        throw Error("Found curly bracket inside a round bracket at " + idxL + " in " + lyrics);
      case ')':
        break OUTER;
      case '}':
        throw Error("Round bracket was not closed before a curly bracket at " + idxL + " in " + lyrics);
      default:
        letter += (letter == "") ? one : '|' + one;
        results.push(lr[1]);
      }
    }
    letters.push(letter);
    return idxL;
  }

  function parseCurly(lyrics, results, letters) {
    var idxL = 0;
    var reserved = [];
    var forDisp = [];
    OUTER: while (idxL < lyrics.length) {
      var lr = getNextLetter(lyrics, idxL);
      idxL = lr[2];
      var one = lr[0];
      switch (one) {
      case '\0':
        throw Error("Curly bracket was not closed until the End of Lyrics");
      case '(':
        idxL += parseRound(lyrics.substr(idxL), reserved, forDisp);
        break;
      case '{':
        throw Error("Found curly bracket used recursively at " + idxL + " in " + lyrics);
      case ')':
        throw Error("Closing round bracket was found without open at " + idxL + " in " + lyrics);
      case '}':
        break OUTER;
      default:
        forDisp.push(one);
        reserved.push(lr[1]);
      }
    }
    MikuEntity.reserved.push([reserved, forDisp]);
    return idxL;
  }

  // this.lyric is just a copy of textarea. Used if textarea is edited.
  // this.slot is used for storing the text for displaying
  // this.commands is for storing commands specified when to execute
  this.commands = {};
  var lines = this.lyric.split('\n');
  var onlyLyric = ""
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var num = null;
    words = line.split(/\s+/);
    var a = /^@(\d+)/.exec(words[0]);
    if (a != null) {
      var num = parseInt(a[1]);
      words.splice(0, 1);
    }
    if (words[0][0] == '#') {
      words[0] = words[0].substr(1); // remove 1st char
      if (num == null) doCommand(words)
      else {
        if (this.commands[num] == undefined) this.commands[num] = [words];
        else this.commands[num].push(words);
      }
    } else {
      onlyLyric = onlyLyric.concat(line);
    }
  }
  console.log("onlyLyric = " + onlyLyric);

  var letters = []; // For display
  var results  = []; // For playing. Chars are changed to more suitable for NSX-39
  this.reserved = []; // For reserving lyrics to write these into NSX-39 while playing.
  parseNormal(onlyLyric, results, letters);

  this.slot = letters;
  this.slotBackup = letters;
  this.firstResult = results;
  console.log("MikuEntity.slot = " + this.slot);
};
MikuEntity.sendThemAll = function (animeRequest) {
  this.parseLyrics();
  writeLyricsIntoPokeMiku(this.firstResult, animeRequest, 1);
};
MikuEntity.changeSlot = function(num) {
  console.log("Change Slot to " + num);
  MIDIOUT.send([0xF0,0x43,0x79,0x09,0x11,0x0D,0x09,0x03,00, num,0xF7]);
  this.curSlot = num;
};
MikuEntity.changeLyricPosition = function(idx) {
  console.log("Change Lyric Position to " + idx);
  MIDIOUT.send([0xF0,0x43,0x79,0x09,0x11,0x0D,0x09,0x02,00, idx,0xF7]);
}

// Before (test) play, create whole positions memo
//   Considers MikuEntity.slot has the 1st lyrics and
//   MikuEntity.reserved has the others.
//   So you should call this AFTER calling MikuEntity.sendThemAll
function initMikuMemo() {
  // Init MikuMemo and MikuPSMemo
  MikuMemo   = []; // For display
  MikuPSMemo = []; // For speicify the position to NSX-39
  var dc = 0;      // counter for display
  var pc = 0;      // counter for PS
  var curLyric = MikuEntity.slotBackup;
  if (curLyric == undefined || curLyric == "") curLyric = MikuEntity.slot;
  if (curLyric == undefined || curLyric == "") return;

  for (var i = 0; i < CurScore.notes.length; i++) {
    // First, change lyrics if we need to.
    var cmds = MikuEntity.commands[i];
    if (cmds != undefined) {
      for (var j = 0; j < cmds.length; j++) {
        if (cmds[j][0] == "WriteReservedLyrics") {
          var num = parseInt(cmds[j][1]);
          curLyric = MikuEntity.reserved[num][1];
          dc = 0;
          pc = 0;
          break;
        }
      }
    }

    var notes = CurScore.notes[i];
    for (var j = 0; j < notes.length; j++) {
      var note    = notes[j] >> 8;
      var sndnum  = note & 0x1F;
      var len     = note >> 5;
      if (sndnum == 15 & len != 1) {
        MikuMemo[i]   = dc;
        MikuPSMemo[i] = pc;
        var letter = curLyric[dc];
        var num = letter.split("|").length;
        dc++;
        if (dc >= curLyric.length) dc = 0;
        pc += num;
        break;
      }
    }
  }
}

// Write Lyrics into PokeMiku:
//   Write arrays of PokeMiku Phonetic Symbols into NEX-39's lyrics slots.
//   "results" is an array of phonetic symbols. Its length must be under 960.
//   func is a function to execute after writing. We need it cause we have to start
//   playing after finished writing lyrics asynchronously.
//   idx is an option to specify start index. I hope it will be never used.
function writeLyricsIntoPokeMiku (results, func, idx) {
 
  // make lyrics writer:
  //   return Promise which writes lyrics (MAX 64 chars) into a NSX-39 lyrics slot
  //   NSX-39 returns the status as MIDI IN data transfer.
  //   MIDI IN listener will be overwritten, then get backed to the original.
  //   NSX-39 always returns BUSY code first, so ignore it.
  //   Slot 0 is in-memory slot and it won't return any status code
  function makeLyricsWriter(result, slot) {
    console.log("makeLyricsWriter: result.length = " + result.length + " slot = " + slot);
    return new Promise(function (resolve, reject) {
      var start = window.performance.now()
      var HEAD = [0xF0,0x43,0x79,0x09,0x11,0x0A,slot];
      var TAIL = 0xF7;
      result = HEAD.concat(result);
      result.push(TAIL);

      var tid = setTimeout(function() {
        reject(new Error('timeout error'))
      }, 500); // Average writing time = 220[ms]

      MIDIIN.onmidimessage = function (e) {
        var err = e.data[6];
        if (e.data[5] == 0x21) {
          if (err == 0) {
            console.log("TIME = " + (window.performance.now() - start));
            clearTimeout(tid);
            resolve("OK"); // Success
          } else if (err == 1) {
            console.log("BUSY!");
          } else if (err == 2) {
            reject('FAIL: Writing lyrics into slot ' + slot);
          }
        }
      }

      MIDIOUT.send(result);

      if (slot == 0) {
        clearTimeout(tid);
        console.log("Timeout Cleared!");
        resolve(0);
      }
    });
  }

  var savedfunc = MIDIIN.onmidimessage;
  if (results.length > 960) console.log("WARN: Too long lyrics. This will fail.");

  var contents = [];
  var num = ~~(results.length >> 6);
  var remainder = results.length - (num << 6);
  if (remainder != 0) num++;
  for (var i = 0; i < num; i++) {
    contents.push(results.slice((i << 6), ((i + 1) << 6)));
  }

  // It seems like NSX-39 can handle only one slot request at a time,
  // so Promises are processed sequencially, not concurrently.
  contents.reduce(function(chain, content, idx) {
    console.log("Length = " + content.length + " idx = " + idx);
    return chain.then(function () {
      return makeLyricsWriter(content, idx + 1);
    }).catch(function (e) {
      console.log("ERR: " + e);
    });
  }, Promise.resolve()).catch(function (e) {
    console.log(e);
  }).then(function () {
    MIDIIN.onmidimessage = savedfunc;
    MikuEntity.changeSlot(1);
    MikuEntity.curSlot = 1;
    MikuEntity.idxL = 0;
    MikuEntity.numOfChars = 0;
    func();
  }).catch(function (e) {
    alert("ERR: " + e);
    console.log(e);
  });
}

// Do Command
//   Execute commands written in Lyrics
//   Commands start with '#', before command you can specify where to start with '@'
//   Example: "@12 #ChangeSlot 3"
//
//   doCommand will be called from Lyrics parser and Play loop
function doCommand(words) {
  var command = words[0];
  switch (command) {
    case "ChangeSlot":
      var num = parseInt(words[1]);
      MikuEntity.changeSlot(num);
      break;
    case "ChangeLyricPosition":
      var num = parseInt(words[1]);
      MikuEntity.chageLyricPosition(num);
      break;
    case "WriteReservedLyrics":
      var num = parseInt(words[1]);
      var results = MikuEntity.reserved[num][0];
      writeLyricsIntoPokeMiku(results, function(){});
      MikuEntity.slot = MikuEntity.reserved[num][1];
      break;
  }
}

// MIDIEntity
function MIDIEntity(channel, program) {
  this.channel = channel;
  this.program = program;
  this.noteOn  = 0x90 | channel;
  this.noteOff = 0x80 | channel;
  // Channel 0 is specific for Miku. Channel 10 is specific for Drum map.
  if (channel == 0 || channel == 10) return;
  MIDIOUT.send([0xC0 | channel, program]);
}
MIDIEntity.prototype = new SoundEntity();
MIDIEntity.prototype.constructor = MIDIEntity;
MIDIEntity.prototype.play = function (key, delay) {
  if (this.channel == 9) key -= 24; // If DrumMap, use drums instead
  if (delay == undefined) delay = 0;
  MIDIOUT.send([this.noteOn, key, 0x7F]);
  MIDIOUT.send([this.noteOff, key, 0x3F], window.performance.now() + 60 / CurScore.tempo * 1000);
};
MIDIEntity.prototype.playChord = function (noteList, delay) {
  for (var i = 0; i < this.prevChord.length; i++) {
    MIDIOUT.send([this.noteOff, this.prevChord[i], 0x7F]);
  }
  this.prevChord = [];
  if (delay == undefined) delay = 0;
  for (var i = 0; i < noteList.length; i++) {
    var key = noteList[i];
    var len = key >> 8;
    key &= 0x7F;
    if (this.channel == 9) key -= 24; // If DrumMap, use drums instead
    if (len == 1) {
      MIDIOUT.send([this.noteOff, key, 0x3F]);
      continue;
    }
    MIDIOUT.send([this.noteOn, key, 0x7F]);
    var oneNoteTime = 60 / CurScore.tempo * 1000;
    var curTime = window.performance.now();
    if (len == 2) MIDIOUT.send([this.noteOff, key, 0x3F], curTime + oneNoteTime * 0.5);
    this.prevChord.push(key);
  }
};

// Factory of Runner Class
function createRunner(name) {
  var mario = {
    checkJump: function () {
      var notes = CurScore.notes[this.pos - 1];
      if (notes == undefined || notes.length == 0) {
        this.isJumping = false;
      } else if (notes.length == 1) {
        this.isJumping = (typeof notes[0] != 'string');
      } else
        this.isJumping = true;
    },
    draw: function () {
      var y = (41 - 22);
      var state = this.state
      if (this.isJumping) {
        state = 2;
        if (this.x == 120) { // In scroll mode
          // (scroll == 16) is just on the bar, 0 and 32 is on the center of between bars
          if (this.scroll != 16) {
            y -= this.jump(this.scroll > 16 ? this.scroll - 16 : this.scroll + 16);
          } /* if scroll == 16 then Mario should be on the ground */
        } else { // Running to the center, or leaving to the goal
          y -= this.jump(Math.round((this.x - 8) % 32));
        }
      }

      L2C.drawImage(this.images[state], this.x * MAGNIFY, y * MAGNIFY);
    },
    leave: function(timeStamp) {
      if (this.start == 0) this.start = timeStamp;

      var diff = timeStamp - this.start;
      if (this.scroll > 0 && this.scroll < 32) {
        this.scroll += Math.floor(diff / 4);
        if (this.scroll > 32) {
          this.x += this.scroll - 32;
          this.scroll = 0;
          CurPos++;
        }
      } else
        this.x = Math.floor(diff / 4) + this.offset;

      if (Math.floor(diff / 100) % 2 == 0) {
        this.state =  8;
        this.draw();
        var w = sweatimg.width;
        var h = sweatimg.height;
        L2C.drawImage(sweatimg,
            0, 0, w, h,
            (this.x - (w + 1)) * MAGNIFY, (41 - 22) * MAGNIFY,
            w * MAGNIFY, h * MAGNIFY);
      } else {
        this.state = 9;
        this.draw();
      }
    }
  };

  var miku = {
    checkJump: function () {this.isJumping = false;},
    draw: function () {
      var y = 41 - 28;
      L2C.drawImage(this.images[this.state], this.x * MAGNIFY, y * MAGNIFY);
    },
    leave: function (timeStamp) {
      if (this.start == 0) this.start = timeStamp;

      var diff = timeStamp - this.start;
      if (this.scroll > 0 && this.scroll < 32) {
        this.scroll += Math.floor(diff / 4);
        if (this.scroll > 32) {
          this.x += this.scroll - 32;
          this.scroll = 0;
          CurPos++;
        }
      } else
        this.x = Math.floor(diff / 4) + this.offset;

      this.timer.checkAndFire(timeStamp);
      this.draw();
    }
  };

  var runner = new RunnerClass();
  var obj = (name == "Miku") ? miku : mario;
  for (var k in obj) {
    runner[k] = obj[k];
  }
  if (name == "Miku") {
    runner.setTimer(new easyTimer(100, function(timer) {
      var state = Runner.state;
      if (++state >= 6) state = 0;
      Runner.state = state;
    }));
  } else {
    runner.setTimer(new easyTimer(100, function(timer) {
      Runner.state = (Runner.state == 1) ? 0 : 1;
    }));
  }
  return runner;
}

// Runner Class. Mario or Miku will inherit from this
function RunnerClass() {
  this.offset = -16; // offset in X
  this.scroll = 0;   // Scroll amount in dots
  this.x = -16;      // X-position in dots.
  this.images = null;
  this.pos = 0;      // position in bar number
  this.state = 0;    // Index of Runner's images
}

RunnerClass.prototype.init = function() {
  this.x = -16;
  this.pos = 0;
  this.start = 0;
  this.state = 0;
  this.scroll = 0;
  this.offset = -16;
  //this.timer = new easyTimer(100, function(timer) {
  //  Runner.state = (Runner.state == 1) ? 0 : 1;
  //});
  //this.timer.switch = true; // forever true;
  this.isJumping = false;
};

RunnerClass.prototype.init4testPlay = function () {
  this.x = -16;
  this.pos = CurPos - 1;
  this.start = 0;
  this.state = 0;
  this.scroll = 0;
  this.offset = -16;
  this.checkJump();
  this.lastTime = 0;
};

// setTimer: set timer instance
// Detached from init so that Mario and Miku can use
// a different timer instance.
RunnerClass.prototype.setTimer = function(t) {
  this.timer = t;
  t.switch = true;
}

RunnerClass.prototype.enter = function(timeStamp) {
  if (this.start == 0) this.start = timeStamp;

  var diff = timeStamp - this.start;
  this.x = Math.floor(diff / 5) + this.offset;
  if (this.x >= 40) this.x = 40; // 16 + 32 - 8
  this.timer.checkAndFire(timeStamp);
  this.draw();
};

RunnerClass.prototype.init4leaving = function() {
  this.offset = this.x;
  this.start = 0;
  this.isJumping = false;
};

/*
 * You can assume that animation is always 60FPS (in theory :-)
 * So 1[frame] is 1 / 60 = 0.1666...[sec]
 * Mario runs 32[dots] per 1[beat]
 * [beat/1sec] = TEMPO[bpm] / 60[sec]
 * [sec/1beat] = 60[sec] / TEMPO[bpm] for 32[dots]
 * 1/60 : 60/TEMPO = x : 32
 * 60x/TEMPO = 32/60
 * x = 32 * TEMPO / 60 * 60 [dots/1frame]
 * Acctually, [msec/1frame] = diff is not always 1/60 * 1000; So,
 * diff : 60 * 1000 / TEMPO = x : 32
 * 60000x/TEMPO = 32diff
 * x = 32 * diff * TEMPO / 60000
 * Logical MAX BPM is when t[sec/1beat] = 2/60, then TEMPO = 1800
 * Because Mario must jump up and down, so he needs 2 times to draw in 1 beat.
 * Real Mario sequencer tempo limit seems 700.
 * So this is good enough.
 * (Famous fastest song, Hatsune Miku no Shoshitsu is 245 (* 4 < 1000))
 * (Mario Sequencer handles only 3 or 4 beat, so if you want to do 8 beat, TEMPO*2)
 *
 * At first, Mario runs to the center of the stage.
 * Then Mario will be fixed at the position.
 * Instead, the score is scrolling from then.
 * When the last bar appears, scroll stops and Mario runs again.
 *
 * Mario should jump from one bar before the next bar which has the note(s)
 *
 */
RunnerClass.prototype.init4playing = function(timeStamp) {
  this.lastTime = timeStamp;
  this.offset = this.x;
  this.scroll = 0;
  this.pos = 1;
  this.state == 1;
  this.checkJump();
};

// function for setting a chord to SoundEntities and playing it
function scheduleAndPlay(notes, time) {
  if (time < 0) time = 0;
  if (notes == undefined || notes.length == 0) return;
  var dic = {};
  for (var i = 0; i < notes.length; i++) {
    var note = notes[i];

    // Dynamic tempo change
    if (typeof note == "string") {
      var tempo = note.split("=")[1];
      CurScore.tempo = tempo;
      document.getElementById("tempo").value = tempo;
      continue;
    }

    //var num = note >> 8;
    //var scale = note & 0xFF;
    var a = decodeNote(note);
    var num = a[0];
    var key = a[1];
    var len = a[3];
    if (num >= 15) key ^= (len << 8);
    if  (!dic[num]) dic[num] = [key];
    else dic[num].push(key);
  }
  for (var i in dic) {
    SOUNDS[i].playChord(dic[i], time / 1000); // [ms] -> [s]
  }

  // Should I move this out of this func?
  var cmds = MikuEntity.commands[Runner.pos - 2];
  if (cmds != undefined) {
    for (var i = 0; i < cmds.length; i++) {
      doCommand(cmds[i]);
    }
  }
}

RunnerClass.prototype.play = function(timeStamp) {

  var tempo = CurScore.tempo
  var diff = timeStamp - this.lastTime; // both are [ms]
  if (diff > 32) diff = 16; // When user hide the tag, force it
  this.lastTime = timeStamp;
  var step = 32 * diff * tempo / 60000; // (60[sec] * 1000)[msec]

  this.timer.checkAndFire(timeStamp);
  var scroll = document.getElementById('scroll');

  var nextBar = (16 + 32 * (this.pos - CurPos + 1) - 8);
  if (Runner.x < 120) { // Mario still has to run
    this.x += step;
    // If this step crosses the bar
    if (this.x >= nextBar) {
      this.pos++;
      scheduleAndPlay(CurScore.notes[this.pos - 2], 0); // Ignore diff
      this.checkJump();
    } else {
      // 32 dots in t[sec/1beat]
      if (this.x >= 120) {
        this.scroll = this.x - 120;
        this.x = 120;
      }
    }
  } else if (CurPos <= CurScore.end - 6) { // Scroll
    this.x = 120;
    if (this.scroll < 16 && (this.scroll + step) >= 16) {
      this.pos++;
      scheduleAndPlay(CurScore.notes[this.pos - 2], 0); // Ignore error
      this.checkJump();
    }
    this.scroll += step;
    while (this.scroll >= 32) { // Virtually adopt any fast tempo
      this.scroll -= 32;
      if (this.scroll >= 16) {
        this.pos++;
        scheduleAndPlay(CurScore.notes[this.pos - 2], 0);
        this.checkJump();
      }
      CurPos++;
      // Force position
      if (this.pos - CurPos < 3) {
        console.log("Skip SOUND!!!");
        this.pos = CurPos + 3
        scheduleAndPlay(CurScore.notes[this.pos - 2], 0);
        this.checkJump();
      }
      scroll.value = CurPos;
      if (CurPos > (CurScore.end - 6)) {
        this.x += this.scroll;
        this.scroll = 0
      }
    }
  } else {
    this.x += step;
    // If this step crosses the bar
    if (this.x >= nextBar) {
      this.pos++;
      scheduleAndPlay(CurScore.notes[this.pos - 2], 0); // Ignore diff
      this.checkJump();
    }
  }
  drawScore(CurPos, CurScore.notes, this.scroll);
  this.draw();
};

RunnerClass.prototype.testPlay = function (timeStamp) {
  var tempo = CurScore.tempo
  var diff = timeStamp - this.lastTime; // both are [ms]
  if (diff > 32) diff = 16; // When user hide the tag, force it
  this.lastTime = timeStamp;
  var step = 32 * diff * tempo / 60000; // (60[sec] * 1000)[msec]

  this.timer.checkAndFire(timeStamp);

  var nextBar = (16 + 32 * (this.pos - CurPos + 1) - 8);
  this.x += step;
  // If this step crosses the bar
  if (this.x >= nextBar) {
    this.pos++;
    scheduleAndPlay(CurScore.notes[this.pos - 2], 0); // Ignore diff
    this.checkJump();
  }
  drawScore(CurPos, CurScore.notes, 0);
  this.draw();
};

// Mario Jump
RunnerClass.prototype.jump = function(x) {
  var h = [0, 2, 4, 6, 8, 10, 12, 13, 14, 15, 16, 17, 18, 18, 19, 19, 19,
           19, 19, 18, 18, 17, 16, 15, 14, 13, 12, 10, 8, 6, 4, 2, 0];
  return h[Math.round(x) % 32];
}

// Timer
function easyTimer(time, func) {
  this.time = time;
  this.func = func;
  this.lastTime = 0;
  this.switch = false;
}

easyTimer.prototype.checkAndFire = function(time) {
  if (this.switch && time - this.lastTime > this.time) {
    this.func(this);
    this.lastTime = time;
  }
};

// SOUNDS is an array for SoundEntity.
// WAV files come first and load wav files async.
// SOUNDS will have MIDI entity later. They don't need loading.
// SOUNDS is now not only an array for sound entitiies,
// but also for characters. CurChar has a index of SOUNDS
// for a Current (selected) Character. This means that eatch SoundEntity
// should have its character image and mini image.
// End Mark and Eraser should have an index of out of SOUNDS for
// convinience. Images for them will be kept by their buttons.
SOUNDS = [];
for (i = 1; i < 21; i++) {
  var tmp = '0';
  tmp += i.toString();
  var file = "wav/sound" + tmp.substr(-2) + ".wav";
  var e = new SoundEntity(file);
  SOUNDS[i-1] = e;
}

// Prepare Mat
MAT = document.getElementById("layer1");
MAT.width  = ORGWIDTH  * MAGNIFY;
MAT.height = ORGHEIGHT * MAGNIFY;
L1C = MAT.getContext('2d');
L1C.imageSmoothingEnabled = false;
var mi = new Image();
mi.src = "image/mat.png";
mi.onload = function() {
  L1C.drawImage(mi, 0, 0, mi.width * MAGNIFY, mi.height * MAGNIFY);
};

// Prepare HIragana
hiraganaimg = new Image();
hiraganaimg.src = "image/hiragana.png";
hiraganaimg.onload = function() {
  HIRAGANA = sliceImage(hiraganaimg, 16, 16, 1);
};

// Prepare Characters
char_sheet = new Image();
char_sheet.src = "image/character_sheet.png";

// Prepare mini Characters
minicimg = new Image();
minicimg.src = "image/minichars.png";

// Prepare note length
notelenimg = new Image();
notelenimg.src = "image/note_length.png";

// Prepare the Bomb!
BOMBS = []
bombimg = new Image();
bombimg.src = "image/bomb.png";
bombTimer = new easyTimer(150, drawBomb);
bombTimer.switch = true;
bombTimer.currentFrame = 0;

function drawBomb(mySelf) {
  var x = 9 * MAGNIFY;
  var y = 202 * MAGNIFY;
  var img = BOMBS[mySelf.currentFrame];
  L1C.drawImage(img, x, y);
  mySelf.currentFrame = (mySelf.currentFrame == 0) ? 1 : 0;

  if (CurSong == undefined || GameStatus != 2) return;
  CurSong.style.backgroundImage =
    "url(" + CurSong.images[mySelf.currentFrame + 1].src + ")";
}

// Prepare the G-Clef. (x, y) = (9, 48)
GClef = new Image();
GClef.src = "image/G_Clef.png";

// Prepare the numbers
numimg = new Image();
numimg.src = "image/numbers.png";

// Prepare the Mario images
marioimg = new Image();
marioimg.src = "image/Mario.png";

sweatimg = new Image();
sweatimg.src = "image/mario_sweat.png";

// Prepare the Miku images
mikuimg = new Image();
mikuimg.src = "image/miku.png";

// Prepare the Eggman images
eggimg = new Image();
eggimg.src = "image/eggman.png";

// Prepare the Play button
playbtnimg = new Image();
playbtnimg.src = "image/play_button.png";

// Prepare the Stop button
stopbtnimg = new Image();
stopbtnimg.src = "image/stop_button.png";

// Prepare the CLEAR button
clearimg = new Image();
clearimg.src = "image/clear_button.png";

// Prepare tempo range slider thumb image
thumbimg = new Image();
thumbimg.src = "image/slider_thumb.png";

// Prepare beat button
beatimg = new Image();
beatimg.src = "image/beat_button.png";

// Prepare Song buttons
songimg = new Image();
songimg.src = "image/song_buttons.png";

// Prepare End Mark
endimg = new Image();
endimg.src = "image/end_mark.png";

// Prepare Semitone
semitoneimg = new Image();
semitoneimg.src = "image/semitone.png";

// Prepare the repeat marks
repeatimg = new Image();
repeatimg.src = "image/repeat_head.png";

function drawRepeatHead(x) {
  var w = RepeatMarks[0].width;
  var h = RepeatMarks[0].height;
  L2C.drawImage(RepeatMarks[0], x * MAGNIFY, 56 * MAGNIFY);
}
// Draw Hiragana
function drawHiragana(letter, x, y) {
  // First, split letter to determin if it contains many chars
  var letters = letter.split('|');
  // results IS an array of result.
  // A result is an array of bytes for one phonetic symbol.
  // The width for displaying a result is one or two CHARSIZE even if result.length = 3.
  // Because 3-byte letter is one of below characters.
  // ぎゃぎゅぎょずぃじゃじゅじょでぃどぅでゅびゃびゅびょぴゃぴゅぴょ
  var results = [];
  var count = 0;
  for (var j = 0; j < letters.length; j++) {
    var result = [];
    letter = letters[j];
    for (var i = 0; i < letter.length; i++) {
      var idx = Uni2Hira[letter.charCodeAt(i) - 0x3041];
      if (idx == undefined) console.log("Uni2Hira failed: letter = " + letter);
      if ((idx & 0x40) == 0x40) { // voiced consonant or dakuon
        result.push(idx ^ 0x40);
        result.push(48);
      } else if ((idx & 0x80) == 0x80) { // semivoiced sound or Handakuon
        result.push(idx ^ 0x80);
        result.push(49);
      } else {
        result.push(idx);
      }
    }
    results.push(result);
    // If the length is 3, it uses both (Dakuon or Handakuon) and small size char.
    // They will take the width of 2 characters
    count += (result.length == 3) ? 2 : result.length;
  }
  var size  = CHARSIZE;
  var ssize = HALFCHARSIZE;
  function drawHiraKomoji(c, x, y) {
    if (c > 54) { // if c is in ぁぃぅぇぉ
      c = c - 55; // use bigger (usual size) instead
      L2C.drawImage(HIRAGANA[c], x + size, y + ssize, ssize, ssize);
    } else {
      L2C.drawImage(HIRAGANA[c], x + size, y, size, size);
    }
  }
  var len = results.length;
  if (len == 2) x -= HALFCHARSIZE;
  else if (len  >= 3) {
    size /= 2;
    ssize /= 2;
  }
  if (len > 4) len = 4; // Ignore over 4 letters. NO SPACE TO DRAW!!
  L2C.imageSmoothingEnabled = false; // Chrome will ignore this probably
  for (var i = 0; i < len; i++) {
    var cx = (i % 2 == 0) ? x : x + size;
    var cy = (i < 2) ? y : y + ssize;
    result = results[i];
    if (MAGNIFY == 1) {
      L2C.drawImage(HIRAGANA[result[0]], cx, cy);
      if (result.length > 1) L2C.drawImage(HIRAGANA[result[1]], cx + size, cy);
      if (result.length > 2) L2C.drawImage(HIRAGANA[result[2]], cx + size, cy);
    } else {
      L2C.drawImage(HIRAGANA[result[0]], cx, cy, size, size);
      if (result.length > 1) drawHiraKomoji(result[1], cx, cy);
      if (result.length > 2) drawHiraKomoji(result[2], cx, cy);
    }
  }
}

// Score Area (8, 41) to (247, 148)
function drawScore(pos, notes, scroll) {
  // Clip only X
  L2C.clearRect(0, 0, SCREEN.width, SCREEN.height);
  L2C.save();
  L2C.rect(8 * MAGNIFY, 0, (247 - 8 + 1) * MAGNIFY, SCRHEIGHT * MAGNIFY);
  L2C.clip();

  var realX = MouseX - OFFSETLEFT;
  var realY = MouseY - OFFSETTOP;
  var g = toGrid(realX, realY);
  var gridX = g[0];
  var gridY = g[1];
  // If mouse cursor on or under the C, draw horizontal line
  //   Edit mode only, no scroll
  if (GameStatus == 0 && g !== false) {
    if (gridY >= 11) drawHorizontalBar(gridX, 0);
  }

  if (pos == 0) {
    var w = GClef.width;
    var h = GClef.height;
    // GClef image is NOT magnified yet.
    L2C.drawImage(GClef,
      0, 0, w, h,
      (9 - scroll) * MAGNIFY, 48 * MAGNIFY, w * MAGNIFY, h * MAGNIFY);

    if (CurScore.loop) {
      drawRepeatHead(41 - scroll);
    }
  } else if (pos == 1 && CurScore.loop) {
    drawRepeatHead(9 - scroll);
  }

  //ORANGE #F89000
  var beats = CurScore.beats;
  // orange = 2, 1, 0, 3, 2, 1, 0, 3, ..... (if beats = 4)
  //        = 2, 1, 0, 2, 1, 0, 2, 1, ..... (if beats = 3)
  var orange = (beats == 4) ? 3 - ((pos + 1) % 4) : 2 - ((pos + 3) % 3);
  var i = (pos < 2) ? (2 - pos) : 0;
  for (; i < 9; i++) {
    var xorg = 16 + 32 * i - scroll;
    var x = xorg * MAGNIFY;
    var barnum = pos + i - 2;

    if (barnum == CurScore.end) {
      var img = CurScore.loop ? RepeatMarks[1] : EndMark;
      L2C.drawImage(img, x - 7 * MAGNIFY, 56 * MAGNIFY);
    }

    L2C.beginPath();
    L2C.setLineDash([MAGNIFY, MAGNIFY]);
    L2C.lineWidth = MAGNIFY;
    if (i % beats == orange) {
      if (GameStatus == 0) drawBarNumber(i, barnum / beats + 1);
      L2C.strokeStyle = '#F89000';
    } else {
      L2C.strokeStyle = '#A0C0B0';
    }
    L2C.moveTo(x,  41 * MAGNIFY);
    L2C.lineTo(x, 148 * MAGNIFY);
    L2C.stroke();

    var b = notes[barnum];
    if (b == undefined) continue;

    // Get notes down
    var delta = 0;
    if ((GameStatus == 2 || GameStatus == 4) && Runner.pos - 2 == barnum) {
      var idx;
      if (Runner.x == 120) {
        idx = (Runner.scroll >= 16) ? Runner.scroll - 16 : Runner.scroll + 16;
      } else {
        idx = Runner.x + 8 - xorg;
      }
      var tbl = [0, 1, 2, 3, 3, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 8,
                 8, 8, 8, 8, 8, 7, 7, 6, 6, 5, 5, 4, 3, 3, 2, 1, 0];
      delta = tbl[Math.round(idx)];
    }
    var hflag = false;
    var exist = [];
    for (var j = 0; j < b.length; j++) {
      if (typeof b[j] == "string") continue; // for dynamic TEMPO

      var a = decodeNote(b[j]);
      var sndnum = a[0];
      var key    = a[1];
      var isFlat = a[2];
      var scale  = key2GridY(key, isFlat);
      var len    = a[3];
      // When CurChar is eraser, and the mouse cursor is on the note,
      // an Image of note blinks.
      if (CurChar == ERASERIDX && g != false && i == gridX && scale == gridY &&
          eraserTimer.currentFrame == 1) {continue;}

      if (!hflag && (scale >= 11)) {
        hflag = true;
        drawHorizontalBar(i, scroll);
      }
      var cx = x - HALFCHARSIZE;
      var cy = (40 + scale * 8 + delta) * MAGNIFY;
      if (MikuEntity.slot != undefined && sndnum == 15) {
        if (exist[scale] == true) L2C.drawImage(HIRAGANA[39], cx, cy, CHARSIZE, CHARSIZE);
        var letter = MikuEntity.slot[MikuMemo[barnum]];
        if (len == 1 || letter == undefined) {
          L2C.drawImage(SOUNDS[sndnum].image, cx, cy);
        } else {
          drawHiragana(letter, cx, cy);
        }
      } else
        L2C.drawImage(SOUNDS[sndnum].image, cx, cy);
      // Alpha blend value maker
      function getAlpha(flipflop) {
        var time = window.performance.now();
        var alpha;
        if (GameStatus == 2) alpha = 1;
        else {
          alpha = (time % 1000) / 1000;
          if (~~(time / 1000) % 2 == flipflop) { // Math.floor
            alpha = 1 - alpha;
          }
        }
        return alpha;
      }
      // Draw Note Length if it need to
      if (len != 0) {
        var alpha = getAlpha(1);
        L2C.save();
        L2C.globalAlpha = alpha;
        L2C.drawImage(NoteLen[len - 1], cx, cy);
        L2C.restore();
      }
      // Draw Note octave if it need to
      if ((key < 59 && !(key == 58 && isFlat)) || key > 80) {
        var octave = ~~(key / 12);
        var doremi = key - octave * 12;
        var origin = (key < 59) ? ((scale == 12) ? 4 : 5) : ((doremi > 8) ? 5 : 6);
        var diff = octave - origin;
        var alpha = getAlpha(0);
        L2C.save();
        L2C.globalAlpha = alpha;
        var sign = (diff < 0) ? GNUMBER[11] : GNUMBER[10];
        L2C.drawImage(sign, cx + 6 * MAGNIFY, cy);
        if (diff < 0) diff = ~diff + 1;
        L2C.drawImage(GNUMBER[diff], cx + 11 * MAGNIFY, cy);
        L2C.restore();
      }

      var x2 = (x - 13 * MAGNIFY);
      var y = (44 + scale * 8 + delta) * MAGNIFY;
      if (isFlat) {
        L2C.drawImage(Semitones[1], x2, y);
      } else if (isEbony(key)) {
        L2C.drawImage(Semitones[0], x2, y);
      }
      exist[scale] = true;
    }
  }
  if (GameStatus == 0) {
    L2C.beginPath();
    L2C.setLineDash([7 * MAGNIFY, 2 * MAGNIFY, 7 * MAGNIFY, 0]);
    L2C.lineWidth = MAGNIFY;
    L2C.strokeStyle = '#F00';
    var xorg = (16 + 32 * gridX - 8);
    var x = xorg * MAGNIFY;
    var y = (40 + gridY * 8) * MAGNIFY;
    L2C.rect(x, y, CHARSIZE, CHARSIZE);
    L2C.stroke();
  }
  L2C.restore();
}

// X is the x of vertical bar (in grid)
function drawHorizontalBar(gridX, scroll) {
  var width = 24 * MAGNIFY;
  L2C.fillRect((4 + 32 * gridX - scroll) * MAGNIFY,
    (38 + 11 * 8) * MAGNIFY + HALFCHARSIZE,
    width, 2 * MAGNIFY);
}

function drawBarNumber(gridX, barnum) {
  var x = (16 + 32 * gridX) * MAGNIFY - 1;
  var y = (40 - 7) * MAGNIFY;
  var nums = [];
  while (barnum > 0) {
    nums.push(barnum % 10);
    barnum = ~~(barnum / 10); // Math.floor
  }
  var len = nums.length;
  if (len == 1) x += 2 * MAGNIFY;
  while (nums.length > 0) {
    var n = nums.pop();
    var width = (n == 4) ? 5 : 4;
    L2C.drawImage(NUMBERS[n], x, y, 5 * MAGNIFY, 7 * MAGNIFY);
    x += width * MAGNIFY;
  }
}

function changeCursor(num) {
  SCREEN.style.cursor = 'url(' + SOUNDS[num].image.src + ')' + HALFCHARSIZE +' '+ HALFCHARSIZE + ', auto';
}

function drawCurChar(image) {
  var x = 4 * MAGNIFY;
  var y = 7 * MAGNIFY;
  L1C.beginPath();
  L1C.imageSmoothingEnabled = false;
  L1C.clearRect(x, y, CHARSIZE, CHARSIZE);
  L1C.drawImage(image, x, y);
  L1C.fillRect(x, y, CHARSIZE, MAGNIFY);
  L1C.fillRect(x, y + CHARSIZE - MAGNIFY, CHARSIZE, MAGNIFY);
}

// Right-Top (19,8)
// 19 - 4 + 1 = 16
// icon size (14, 13)
function drawEndMarkIcon(img) {
  L1C.clearRect(4 * MAGNIFY, 8 * MAGNIFY, 16 * MAGNIFY, 14 * MAGNIFY);
  L1C.drawImage(img, 5 * MAGNIFY, 8 * MAGNIFY);
}
// Draw Eraser Icon
// In fact, this only erases Icon
function drawEraserIcon() {
  L1C.clearRect(4 * MAGNIFY, 8 * MAGNIFY, 16 * MAGNIFY, 14 * MAGNIFY);
}

function toGrid(realX, realY) {
  var gridLeft   = (8   + 0) * MAGNIFY;
  var gridTop    = (41  + 2) * MAGNIFY;
  var gridRight  = (247 - 4) * MAGNIFY;
  var gridBottom = (148 - 4) * MAGNIFY;
  if (realX < gridLeft || realX > gridRight ||
      realY < gridTop  || realY > gridBottom)
    return false;

  var gridX = ~~((realX - gridLeft) / CHARSIZE); // Math.floor
  if (gridX % 2 != 0) return false; // Not near the bar
  gridX /= 2;
  var gridY = ~~((realY - gridTop) / HALFCHARSIZE);

  // Consider G-Clef and repeat head area
  if (CurPos == 0 && gridX < 2 || CurPos == 1 && gridX == 0)
    return false;
  else
    return [gridX, gridY];
}

SCREEN = document.getElementById("layer2");
// You should not use .style.width(or height) here.
// You must not append "px" here.
SCREEN.width  = ORGWIDTH  * MAGNIFY;
SCREEN.height = SCRHEIGHT * MAGNIFY;
L2C = SCREEN.getContext('2d');
L2C.imageSmoothingEnabled = false;
// Delete
// Google don't support MouseEvent.buttons even it is in W3C standard?
// Low priority? No milestone?
// I'm outta here. #IAmGoogle
// https://code.google.com/p/chromium/issues/detail?id=276941
SCREEN.addEventListener("contextmenu", mouseClickListener);

// ClipRect (8, 41) to (247, 148)
SCREEN.addEventListener("click", mouseClickListener);

function mouseClickListener(e) {
  if (GameStatus != 0) return;
  e.preventDefault();

  var realX = e.clientX - OFFSETLEFT;
  var realY = e.clientY - OFFSETTOP;

  var g = toGrid(realX, realY);
  if (g == false) return;
  var gridX = g[0];
  var gridY = g[1];

  // Map logical x to real bar number
  var b = CurPos + gridX - 2;

  // process End Mark
  if (CurChar == ENDMARKIDX) {
    CurScore.end = b;
    return;
  }

  if (b >= CurScore.end) return;

  var notes = CurScore.notes[b];
  // Delete
  if (CurChar == ERASERIDX || e.button == 2) {
    // Delete Top of the stack
    for (var i = notes.length - 1; i >= 0; i--) {
      var a = decodeNote(notes[i]);
      var note = a[1];
      var isFlat = a[2];
      if (key2GridY(note, isFlat) == gridY) {
        notes.splice(i, 1);
        CurScore.notes[b] = notes;
        SysSnd.click.play(65);
        break;
      }
    }
    return;
  }

  // Handle semitone
  var note = encodeNote(gridY, CurChar, e.shiftKey, e.ctrlKey, 0);
  var a1 = decodeNote(note); // To change gridY to Key
  var found = undefined;
  for (var i = 0; i < notes.length; i++) {
    var a2 = decodeNote(notes[i]);
    if (a1[0] == a2[0]) {
      if (a1[0] == 15) {found = i; break;}
      if (a1[1] == a2[1]) return;
      if (key2GridY(a2[1], a2[2]) == gridY) return;
    }
  }
  if (found != undefined) {
    notes.splice(found, 1); // If SND is Miku, delete old one
  }
  SOUNDS[CurChar].play(note & 0x7F);
  notes.push(note);
  CurScore['notes'][b] = notes;
}

SCREEN.addEventListener("mousemove", function(e) {
  MouseX = e.clientX;
  MouseY = e.clientY;
});

// Read MSQ File
// You really need this "dragover" event listener.
// Check StackOverflow: http://bit.ly/1hHEINZ
SCREEN.addEventListener("dragover", function(e) {
  e.preventDefault();
  return false;
});
// Translate dropped MSQ files into inner SCORE array.
// You have to handle each file sequencially,
// But you might want to download files parallel.
// In such a case, Promise is very convenient utility.
// http://www.html5rocks.com/en/tutorials/es6/promises/
SCREEN.addEventListener("drop", function(e) {
  e.preventDefault();
  clearSongButtons();
  fullInitScore();
  // function to read a given file
  // Input is a instance of a File object.
  // Returns a instance of a Promise.
  function readFile(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.name = file.name;
      reader.addEventListener("load", function(e) {
        resolve(e.target);
      });
      reader.readAsText(file);
    });
  }

  // FileList to Array for Mapping
  var files = [].slice.call(e.dataTransfer.files);
  // Support Mr.Phenix's files. He numbered files with decimal numbers :-)
  // http://music.geocities.jp/msq_phenix/
  // For example, suite15.5.msq must be after the suite15.msq
  files.sort(function(a,b) {
    var n1 = a.name;
    var n2 = b.name;
    function strip(name) {
      n = /\d+\.\d+|\d+/.exec(name);
      if (n == null) return 0;
      n = n[0];
      return parseFloat(n);
    }
    return strip(n1) - strip(n2);
  });
  files.map(function(x){console.log(x.name)});
  files.map(readFile).reduce(function(chain, fp, idx) {
    return chain.then(function() {
      return fp;
    }).then(function(fileReader) {
      var ext = fileReader.name.slice(-3);
      if (ext == "msq") {
        addMSQ(fileReader.result);
      } else {
        addJSON(fileReader.result);
      }
    }).catch(function(err) {
      alert("Loading MSQ failed: " + err.message);
      console.log(err);
    });
  }, Promise.resolve())
  .then(closing);

  return false;
});

// Closing to add files to the score
//   Configure Score parameters
function closing() {
  // Finally, after reducing, set parameters to Score
  var b = document.getElementById(CurScore.beats == 3 ? '3beats' : '4beats');
  var e = new Event("click");
  e.soundOff = true;
  b.dispatchEvent(e);

  var r = document.getElementById('scroll');
  CurMaxBars = CurScore.end + 1;
  r.max = CurMaxBars - 6;
  r.value = 0;
  CurPos = 0;

  var tempo = CurScore.notes[0][0];
  if (typeof tempo == "string" && tempo.substr(0, 5) == "TEMPO") {
    tempo = tempo.split("=")[1];
    CurScore.tempo = tempo;
    document.getElementById("tempo").value = tempo;
  }
}

function addMSQ(text) {
  var lines = text.split(/\r\n|\r|\n/);
  var keyword = ["SCORE", "TEMPO", "LOOP", "END", "TIME44"];
  var values = {};
  lines.forEach(function(line, i) {
    if (line === "") return;
    var kv = line.split("=");
    var k = kv[0];
    var v = kv[1];
    if (i < keyword.length && k !== keyword[i]) {
      throw new Error("Line " + i + " must start with '" + keyword[i] + "'");
    }
    this[k] = v;
  }, values);

  var oldEnd = CurScore.end;
  var s = values.SCORE;
  var i = 0, count = CurScore.end;
  // MSQ format is variable length string.
  out:
  while (i < s.length) {
    var bar = [];
    for (var j = 0; j < 3; j++) {
      if (s[i] === "\r" || s[i] == undefined) break out;
      var scale = parseInt(s[i++], 16);
      if (scale !== 0) {
        scale -= 1;
        var tone = parseInt(s[i++], 16) - 1;
//        var note = (tone << 8) | scale;
        var note = encodeNote(scale, tone);
        bar.push(note);
      }
    }
    CurScore.notes[count++] = bar;
  }

  CurScore.end  += parseInt(values.END) - 1;
  if (CurScore.tempo != values.TEMPO)
    CurScore.notes[oldEnd].splice(0, 0, "TEMPO=" + values.TEMPO);
  CurScore.tempo = values.TEMPO;
  var beats = (values.TIME44 == "TRUE") ? 4 : 3;
  CurScore.beats = beats;
  // click listener will set CurScore.loop
  var b = document.getElementById("loop");
  (values.LOOP == "TRUE") ? b.set() : b.reset();
}

// addJSON
//   Prase JSON and add contents into CurScore
//   Input parameter type is FileReader,
//   but use only its result property.
//   This means you can use any object with result.
function addJSON(text) {
  var json = JSON.parse(text);
  for (var i = 0; i < json.end; i++)
    CurScore.notes.push(json.notes[i]);

  var notes = CurScore.notes[CurScore.end];
  if (CurScore.tempo != json.tempo && notes.length != 0) {
    var tempostr = notes[0];
    if (typeof tempostr != "string") {
      notes.splice(0, 0, "TEMPO=" + json.tempo);
    }
  }
  CurScore.tempo = json.tempo;
  CurScore.end += json.end;

  var b = document.getElementById("loop");
  if (json.loop) b.set(); else b.reset();

  var b = document.getElementById("lyric");
  if (json.lyric) b.value = json.lyric;
}

function doAnimation(time) {
  // Bomb
  bombTimer.checkAndFire(time);
  eraserTimer.checkAndFire(time);
  endMarkTimer.checkAndFire(time);

  drawScore(CurPos, CurScore['notes'], 0);

  if (GameStatus != 0) return;

  requestAnimFrame(doAnimation);
}

function makeButton(x, y, w, h) {
  var b = document.createElement("button");
  b.className = "game";
  b.style.position = 'absolute';
  moveDOM(b, x, y);
  resizeDOM(b, w, h);
  b.style['z-index'] = 3;
  b.style.background = "rgba(0,0,0,0)";

  // Save position and size for later use
  b.originalX = x;
  b.originalY = y;
  b.originalW = w;
  b.originalH = h;
  b.redraw = function() {
    moveDOM(this, this.originalX, this.originalY);
    resizeDOM(this, this.originalW, this.originalH);
  }
  return b;
}

function resizeDOM(b, w, h) {
  b.style.width =  w * MAGNIFY + "px";
  b.style.height = h * MAGNIFY + "px";
}

function moveDOM(b, x, y) {
  b.style.left =   x * MAGNIFY + "px";
  b.style.top =    y * MAGNIFY + "px";
}

// Select Listener
function selectListener(e) {
  console.log(e);
  MAGNIFY = e.target.selectedIndex + 1;
  resizeScreen();
}

// Make Green
// Change color of Numbers to Green
function makeGreen(img) {
  var w = img.width;
  var h = img.height;
  var c = document.createElement("canvas");
  c.width  = w;
  c.height = h;
  var cc = c.getContext("2d");
  cc.drawImage(img, 0, 0);
  var id = cc.getImageData(0, 0, w, h);
  for (var i = 0; i < id.data.length; i += 4) {
    if (id.data[i + 3] == 255) {
      id.data[i + 1] = 255;
    } else id.data[i + 3] = 64;
  }
  cc.putImageData(id, 0, 0);
  var result = new Image();
  result.src = c.toDataURL();
  return result;
}

// resize screen using MAGNIFY
//   If we can use Elm.style.imageRendering = Crisp-edged,
//   You can avoid these re-configuring. Sigh.
function resizeScreen() {
  CHARSIZE = 16 * MAGNIFY;
  HALFCHARSIZE = Math.floor(CHARSIZE / 2);

  CONSOLE.style.width  = ORGWIDTH  * MAGNIFY + "px";
  CONSOLE.style.height = ORGHEIGHT * MAGNIFY + "px";
  OFFSETLEFT = CONSOLE.offsetLeft;
  OFFSETTOP  = CONSOLE.offsetTop;

  BOMBS = sliceImage(bombimg, 14, 18);
  Mario.images = sliceImage(marioimg, 16, 22);
  Miku.images = sliceImage(mikuimg, 20, 28);
  Semitones = sliceImage(semitoneimg, 5, 12);
  EGGMAN.images = sliceImage(eggimg, 16, 16);
  NoteLen = sliceImage(notelenimg, 16, 16);

  MAT.width  = ORGWIDTH  * MAGNIFY;
  MAT.height = ORGHEIGHT * MAGNIFY;
  L1C.drawImage(mi, 0, 0, mi.width * MAGNIFY, mi.height * MAGNIFY);

  SCREEN.width  = ORGWIDTH  * MAGNIFY;
  SCREEN.height = SCRHEIGHT * MAGNIFY;

  var imgs = sliceImage(char_sheet, 16, 16);
  var mini = sliceImage(minicimg, 11, 12);
  for (var i = 0; i < 31; i++) { // NEED FIX when you get more MIDI notes
    SOUNDS[i].image = imgs[i];
    SOUNDS[i].minic = mini[i];
  }
  for (var i = 0; i < BUTTONS.length; i++) {
    var b = BUTTONS[i];
    b.redraw();
    if (i < 15) {
      b.drawChar();
    }
  }
  BUTTONS[15].images = sliceImage(endimg, 14, 13);
  endMarkTimer.images = BUTTONS[15].images;
  EGGMAN.draw();

  // Endmark Cursor (= ENDMARKIDX) will be redrawn by its animation
  // Eraser (= ERASERIDX) will be redrawn later below
  if (CurChar >= 0 && CurChar < SOUNDS.length) {
   changeCursor(CurChar);
  }

  if (CurChar == ENDMARKIDX)
    drawEndMarkIcon(BUTTONS[15].images[0]);
  else if (CurChar == ERASERIDX)
    drawEraserIcon();
  else
    drawCurChar(SOUNDS[CurChar].image);

  var b = document.getElementById("play");
  b.redraw();
  b.images = sliceImage(playbtnimg, 12, 15);
  var num = b.disabled ? 1 : 0;
  b.style.backgroundImage = "url(" + b.images[num].src + ")";

  var b = document.getElementById("stop");
  b.redraw();
  var imgs = sliceImage(stopbtnimg, 16, 15);
  b.images = [imgs[0], imgs[1]];
  b.style.backgroundImage = "url(" + b.images[1 - num].src + ")";

  var b = document.getElementById("loop");
  b.redraw();
  b.images = [imgs[2], imgs[3]]; // made in Stop button (above)
  var num = CurScore.loop ? 1 : 0;
  b.style.backgroundImage = "url(" + b.images[num].src + ")";

  // Prepare Repeat (global!)
  RepeatMarks = sliceImage(repeatimg, 13, 62);
  EndMark = RepeatMarks[2];

  var b = document.getElementById("scroll");
  moveDOM(b, b.originalX, b.originalY);
  resizeDOM(b, b.originalW, b.originalH);
  var rules = PseudoSheet.cssRules;
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].selectorText == "#scroll::-webkit-slider-thumb") {
      PseudoSheet.deleteRule(i);
      PseudoSheet.insertRule('#scroll::-webkit-slider-thumb {' +
        "-webkit-appearance: none !important;" +
        "border-radius: 0px;" +
        "background-color: #A870D0;" +
        "box-shadow:inset 0 0 0px;" +
        "border: 0px;" +
        "width: " + 5 * MAGNIFY + "px;" +
        "height:" + 7 * MAGNIFY + 'px;}', 0
      );
    }
  }
  var b = document.getElementById("toLeft");
  b.redraw();
  var b = document.getElementById("toRight");
  b.redraw();
  var b = document.getElementById("clear");
  b.redraw();
  b.images = sliceImage(clearimg, 34, 16);
  b.style.backgroundImage = "url(" + b.images[0].src + ")";

  // Make number images from the number sheet
  NUMBERS = sliceImage(numimg, 5, 7);
  GNUMBER = sliceImage(gnumimg, 5, 7);

  var b = document.getElementById("3beats");
  b.redraw();
  var imgs = sliceImage(beatimg, 14, 15);
  b.images = [imgs[0], imgs[1]];
  var num = (CurScore.beats == 3) ? 1 : 0;
  b.style.backgroundImage = "url(" + b.images[num].src + ")";
  var b = document.getElementById("4beats");
  b.redraw();
  b.images = [imgs[2], imgs[3]];
  b.style.backgroundImage = "url(" + b.images[1 - num].src + ")";

  var b = document.getElementById("frog");
  b.redraw();
  var imgs = sliceImage(songimg, 15, 17);
  b.images = [imgs[0], imgs[1], imgs[2]];
  var num = (CurSong === b) ? 1 : 0;
  b.style.backgroundImage = "url(" + b.images[num].src + ")";
  var b = document.getElementById("beak");
  b.redraw();
  b.images = [imgs[3], imgs[4], imgs[5]];
  var num = (CurSong === b) ? 1 : 0;
  b.style.backgroundImage = "url(" + b.images[num].src + ")";
  var b = document.getElementById("1up");
  b.redraw();
  b.images = [imgs[6], imgs[7], imgs[8]];
  var num = (CurSong === b) ? 1 : 0;
  b.style.backgroundImage = "url(" + b.images[num].src + ")";
  var b = document.getElementById("eraser");
  b.redraw();
  b.images = [imgs[9], imgs[10], imgs[11]];
  var num;
  if (CurChar == ERASERIDX) {
    num = 1;
    SCREEN.style.cursor = 'url(' + b.images[2].src + ')' + ' 0 0, auto';
  } else {
    num = 0;
  }
  b.style.backgroundImage = "url(" + b.images[num].src + ")";

  var b = document.getElementById("tempo");
  moveDOM(b, b.originalX, b.originalY);
  resizeDOM(b, b.originalW, b.originalH);
  var rules = PseudoSheet.cssRules;
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].selectorText == "#tempo::-webkit-slider-thumb") {
      PseudoSheet.deleteRule(i);
      PseudoSheet.insertRule('#tempo::-webkit-slider-thumb {' +
        "-webkit-appearance: none !important;" +
        "background-image: url('" + b.image.src + "');" +
        "background-repeat: no-repeat;" +
        "background-size: 100% 100%;" +
        "border: 0px;" +
        "width: " + 5 * MAGNIFY + "px;" +
        "height:" + 8 * MAGNIFY + 'px;}', 0
      );
    }
  }
}

// INIT routine
window.addEventListener("load", onload);
function onload() {
  // Note Length images
  NoteLen = sliceImage(notelenimg, 16, 16);

  // Make buttons for changing a kind of notes.
  //   1st mario:   x=25, y=9, width=11, height=12
  //   2nd Kinopio: X=39, y=9, width=11, height=12
  //   and so on...
  var bimgs = sliceImage(char_sheet, 16, 16);
  var minis = sliceImage(minicimg, 11, 12);
  for (var i = 0; i < 15; i++) {
    var b = makeButton((25 + 14 * i), 9, 11, 12);
    b.se = SOUNDS[i];
    b.se.num = i;
    b.se.image = bimgs[i];
    b.se.minic = minis[i];
    b.drawChar = function() {
      // this.style.backgroundImage = "url(" + this.se.minic.src + ")";
      L1C.drawImage(this.se.minic, this.originalX * MAGNIFY, this.originalY * MAGNIFY);
    };
    b.drawChar();
    b.addEventListener("click", function() {
      this.se.play(65); // Note F
      CurChar = this.se.num;
      clearEraserButton();
      changeCursor(this.se.num);
      drawCurChar(this.se.image);
    });
    CONSOLE.appendChild(b);
    BUTTONS[i] = b;
  }

  // Prepare End Mark button (Char. No. 15)
  var b = makeButton(67, 203, 13, 14);
  b.images = sliceImage(endimg, 14, 13); // Note: Different size from the button
  endMarkTimer = new easyTimer(150, function (self) {
    // If current is not end mark, just return;
    if (CurChar != ENDMARKIDX) {
      self.switch = false;
      return;
    }
    self.currentFrame = (self.currentFrame == 0) ? 1 : 0;
    SCREEN.style.cursor = 'url(' + self.images[self.currentFrame].src + ')' +
      7 * MAGNIFY +' '+ 7 * MAGNIFY + ', auto';
  });
  endMarkTimer.images = b.images;
  endMarkTimer.currentFrame = 0;
  b.addEventListener("click", function() {
    endMarkTimer.switch = true;
    CurChar = ENDMARKIDX;
    SysSnd.endmark.play(65);
    clearEraserButton();
    drawEndMarkIcon(this.images[0]);
  });
  CONSOLE.appendChild(b);
  BUTTONS[15] = b;

  // Prepare Eggman Button
  EGGMAN = makeButton(236, 6, 16, 16);
  EGGMAN.id = "eggman";
  EGGMAN.images = sliceImage(eggimg, 16, 16);
  EGGMAN.current = 1;
  EGGMAN.startIdx = function() {
    return (this.current % 2 == 1) ? 0 : 15;
  }
  EGGMAN.draw = function() {
    this.style.backgroundImage = "url(" + this.images[this.current].src + ")";
  };
  EGGMAN.draw();
  EGGMAN.addEventListener("click", function() {
    SOUNDS[12].play(60 + this.current);
    var curchar = CurChar - BUTTONS[0].se.num;
    this.current++;
    if (this.current > 15) {this.current = 1};
    this.draw();
    var begin = this.startIdx();
    for (var i = 0; i < 15; i++) {
      BUTTONS[i].se = SOUNDS[begin + i];
      BUTTONS[i].drawChar();
    }
    CurChar = begin + curchar;
    drawCurChar(SOUNDS[CurChar].image);
    changeCursor(SOUNDS[CurChar].num);
  });
  CONSOLE.appendChild(EGGMAN);
  BUTTONS[16] = EGGMAN;

  // For inserting pseudo elements' styles
  var s = document.createElement("style");
  document.head.appendChild(s);
  PseudoSheet = s.sheet;

  // Prepare Play Button (55, 168)
  var b = makeButton(55, 168, 12, 15);
  b.id = 'play';
  b.images = sliceImage(playbtnimg, 12, 15);
  b.style.backgroundImage = "url(" + b.images[0].src + ")";
  b.addEventListener("click", playListener);
  s.sheet.insertRule('button:focus {outline: none !important;}', 0);
  CONSOLE.appendChild(b);

  // Prepare Stop Button (21, 168)
  var b = makeButton(21, 168, 16, 15);
  b.id = 'stop';
  b.disabled = false;
  // stopbtn image including loop button (next)
  var imgs = sliceImage(stopbtnimg, 16, 15);
  b.images = [imgs[0], imgs[1]];
  b.style.backgroundImage = "url(" + b.images[1].src + ")";
  b.addEventListener("click", stopListener);
  s.sheet.insertRule('#stop:focus {outline: none !important;}', 0);
  CONSOLE.appendChild(b);

  // Prepare Loop Button (85, 168)
  var b = makeButton(85, 168, 16, 15);
  b.id = 'loop';
  b.images = [imgs[2], imgs[3]]; // made in Stop button (above)
  b.style.backgroundImage = "url(" + b.images[0].src + ")";
  CurScore.loop = false;
  b.addEventListener("click", function(e) {
    var num;
    if (CurScore.loop) {
      CurScore.loop = false;
      num = 0;
    } else {
      CurScore.loop = true;
      num = 1;
    }
    this.style.backgroundImage = "url(" + this.images[num].src + ")";
    SysSnd.click.play(65);
  });
  b.reset = function () {
    CurScore.loop = false;
    this.style.backgroundImage = "url(" + this.images[0].src + ")";
  };
  b.set   = function () {
    CurScore.loop = true;
    this.style.backgroundImage = "url(" + this.images[1].src + ")";
  }
  s.sheet.insertRule('#loop:focus {outline: none !important;}', 0);
  CONSOLE.appendChild(b);

  // Prepare Repeat (global!)
  RepeatMarks = sliceImage(repeatimg, 13, 62);
  EndMark = RepeatMarks[2];

  // Prepare Scroll Range
  var r = document.createElement('input');
  r.id = 'scroll';
  r.type = 'range';
  r.value = 0;
  r.max = CurMaxBars - 6;
  r.min = 0;
  r.step = 1;
  r.style['-webkit-appearance']='none';
  r.style['border-radius'] = '0px';
  r.style['background-color'] = '#F8F8F8';
  r.style['box-shadow'] = 'inset 0 0 0 #000';
  r.style['vertical-align'] = 'middle';
  r.style.position = 'absolute';
  r.style.margin = 0;
  r.originalX = 191;
  r.originalY = 159;
  r.originalW = 50;
  r.originalH = 7;
  moveDOM(r, r.originalX, r.originalY);
  resizeDOM(r, r.originalW, r.originalH);
  r.addEventListener("input", function(e) {
    CurPos = parseInt(this.value);
  });
  CONSOLE.appendChild(r);

  // It's very hard to set values to a pseudo element with JS.
  // http://pankajparashar.com/posts/modify-pseudo-elements-css/
  s.sheet.insertRule('#scroll::-webkit-slider-thumb {' +
    "-webkit-appearance: none !important;" +
    "border-radius: 0px;" +
    "background-color: #A870D0;" +
    "box-shadow:inset 0 0 0px;" +
    "border: 0px;" +
    "width: " + 5 * MAGNIFY + "px;" +
    "height:" + 7 * MAGNIFY + "px;}", 0
  );
  s.sheet.insertRule('#scroll:focus {outline: none !important;}', 0);

  // Make number images from the number sheet
  NUMBERS = sliceImage(numimg, 5, 7);
  gnumimg = makeGreen(numimg);
  GNUMBER = sliceImage(gnumimg, 5, 7);

  // Prepare Beat buttons w=14, h=15 (81, 203) (96, 203)
  // (1) Disable self, Enable the other
  // (2) Change both images
  // (3) Play Sound
  // (4) Set CurScore.beat
  function makeExclusiveFunction(doms, num, success) {
    var clone = doms.slice(0); // Clone the Array
    var self = clone[num];
    clone.splice(num, 1); // Remove No.i element
    var theOthers = clone;

    return function(e) {
      // Sound Off for file loading
      if (!e.soundOff) SysSnd.click.play(65);
      self.disabled = true;
      self.style.backgroundImage = "url(" + self.images[1].src + ")";
      theOthers.map(function (x) {
        x.disabled = false;
        x.style.backgroundImage = "url(" + x.images[0].src + ")";
      });
      success(self);
    };
  }

  var imgs = sliceImage(beatimg, 14, 15);
  var b1 = makeButton(81, 203, 14, 15);
  b1.id = '3beats';
  b1.beats = 3;
  b1.images = [imgs[0], imgs[1]];
  b1.style.backgroundImage = "url(" + b1.images[0].src + ")";
  b1.disabled = false;
  CONSOLE.appendChild(b1);
  var b2 = makeButton(96, 203, 14, 15);
  b2.id = '4beats';
  b2.beats = 4;
  b2.images = [imgs[2], imgs[3]];
  b2.style.backgroundImage = "url(" + b2.images[1].src + ")";
  b2.disabled = true;
  CONSOLE.appendChild(b2);
  var func = function(self) {CurScore.beats = self.beats};
  b1.addEventListener("click", makeExclusiveFunction([b1, b2], 0, func));
  b2.addEventListener("click", makeExclusiveFunction([b1, b2], 1, func));

  // Preapre Song Buttons (136, 202) 15x17, 160 - 136 = 24
  var imgs = sliceImage(songimg, 15, 17);
  var b = ['frog','beak','1up'].map(function (id, idx) {
    var b = makeButton(136 + 24 * idx, 202, 15, 17);
    b.id = id;
    b.num = idx;
    b.images = imgs.slice(idx * 3, idx * 3 + 3);
    b.style.backgroundImage = "url(" + b.images[0].src + ")";
    b.disabled = false;
    CONSOLE.appendChild(b);
    return b;
  });
  var func = function (self) {
    CurScore = clone(EmbeddedSong[self.num]);
    document.getElementById("tempo").value = CurScore.tempo;
    var b = document.getElementById("loop");
    if (CurScore.loop) b.set(); else b.reset();
    var s = document.getElementById("scroll");
    CurMaxBars = CurScore.end + 1;
    s.max = CurMaxBars - 6;
    s.value = 0;
    CurPos = 0;
    CurSong = self;
  };
  b[0].addEventListener("click", makeExclusiveFunction(b, 0, func));
  b[1].addEventListener("click", makeExclusiveFunction(b, 1, func));
  b[2].addEventListener("click", makeExclusiveFunction(b, 2, func));

  // Prepare Eraser (Warning: Depends on the Song button images)
  b = makeButton(40, 202, 15, 17);
  b.id = 'eraser';
  b.images = [imgs[9], imgs[10], imgs[11]]; // In the Song button images
  b.style.backgroundImage = "url(" + b.images[0].src + ")";
  eraserTimer = new easyTimer(200, function (self) {
    // If current is not end mark, just return;
    if (CurChar != ERASERIDX) {
      self.switch = false;
      return;
    }
    self.currentFrame = (self.currentFrame == 0) ? 1 : 0;
  });
  eraserTimer.currentFrame = 0;
  b.addEventListener("click", function() {
    eraserTimer.switch = true;
    CurChar = ERASERIDX;
    SysSnd.click.play(65);
    drawEraserIcon();
    clearSongButtons();
    this.style.backgroundImage = "url(" + this.images[1].src + ")";
    SCREEN.style.cursor = 'url(' + this.images[2].src + ')' + ' 0 0, auto';
  });
  CONSOLE.appendChild(b);

  // Prepare tempo range
  // (116, 172) width 40px, height 8px
  var r = document.createElement('input');
  r.id = 'tempo';
  r.type = 'range';
  r.value = 525;
  r.max = 1000;
  r.min = 50;
  r.step = 1;
  r.style['-webkit-appearance']='none';
  r.style['border-radius'] = '0px';
  r.style['background-color'] = 'rgba(0, 0, 0, 0.0)';
  r.style['box-shadow'] = 'inset 0 0 0 #000';
  r.style['vertical-align'] = 'middle';
  r.style.position = 'absolute';
  r.style.margin = 0;
  r.originalX = 116;
  r.originalY = 172;
  r.originalW = 40;
  r.originalH = 8;
  moveDOM(r, r.originalX, r.originalY);
  resizeDOM(r, r.originalW, r.originalH);
  r.addEventListener("input", function(e) {
    CurScore.tempo = parseInt(this.value);
  });
  CONSOLE.appendChild(r);

  var t = sliceImage(thumbimg, 5, 8)[0];
  r.image = t;
  // It's very hard to set values to a pseudo element with JS.
  // http://pankajparashar.com/posts/modify-pseudo-elements-css/
  s.sheet.insertRule('#tempo::-webkit-slider-thumb {' +
    "-webkit-appearance: none !important;" +
    "background-image: url('" + t.src + "');" +
    "background-repeat: no-repeat;" +
    "background-size: 100% 100%;" +
    "border: 0px;" +
    "width: " + 5 * MAGNIFY + "px;" +
    "height:" + 8 * MAGNIFY + 'px;}', 0
  );
  s.sheet.insertRule('#tempo:focus {outline: none !important;}', 0);

  // Prepare range's side buttons for inc/decrements
  var b = makeButton(184, 158, 7, 9);
  b.id = 'toLeft';
  b.addEventListener("click", function (e) {
    var r = document.getElementById('scroll');
    if (r.value > 0) {
      CurPos = --r.value;
    }
  });
  CONSOLE.appendChild(b);

  var b = makeButton(241, 158, 7, 9);
  b.id = 'toRight';
  b.addEventListener("click", function (e) {
    var r = document.getElementById('scroll');
    if (r.value < CurMaxBars - 6) {
      CurPos = ++r.value;
    }
  });
  CONSOLE.appendChild(b);

  // Prepare CLEAR button (200, 176)
  var b = makeButton(200, 176, 34, 16);
  b.id = 'clear';
  b.images = sliceImage(clearimg, 34, 16);
  b.style.backgroundImage = "url(" + b.images[0].src + ")";
  b.addEventListener("click", clearListener);
  CONSOLE.appendChild(b);
  s.sheet.insertRule('#clear:focus {outline: none !important;}', 0);

  // Prepare current empty score
  initScore();

  // Initializing Screen
  CurPos = 0;
  CurChar = 0;
  drawCurChar(SOUNDS[CurChar].image);
  changeCursor(CurChar);
  drawScore(CurPos, CurScore['notes'], 0);

  // Make bomb images from the bomb sheet
  BOMBS = sliceImage(bombimg, 14, 18);
  var b = makeButton(9, 202, 14, 18);
  BUTTONS[17] = b;
  b.id = 'bomb';
  b.addEventListener("click", function(e) {
    bombTimer.switch = false;
    // Play booom
    var source = AC.createBufferSource();
    source.buffer = SysSnd.bomb.buffer;
    source.playbackRate.value = Math.pow(SEMITONERATIO, -24);
    source.connect(AC.destination);
    source.onended = function () {
      bombTimer.switch = true;
    };
    source.start(0);
    // Change background
    var x = 9 * MAGNIFY;
    var y = 202 * MAGNIFY;
    var img = BOMBS[2];
    L1C.drawImage(img, x, y);
    // Change Runner, Mario to Miku or vice versa
    var prev;
    if (Runner === Miku) {
      Runner = Mario;
      prev   = Miku;
    } else {
      Runner = Miku;
      prev   = Mario;
    }
    Runner.x = prev.x;
    Runner.pos = prev.pos;
    Runner.scroll = prev.scroll;
    Runner.offset = prev.offset;
    Runner.lastTime = prev.lastTime;
  });
  CONSOLE.appendChild(b);

  // Make Mario images
  Mario = createRunner("Mario");
  Mario.images = sliceImage(marioimg, 16, 22);

  // Make Miku images
  Miku = createRunner("Miku");
  Miku.images = sliceImage(mikuimg, 20, 28);
  Runner = Miku;

  // Make Semitone images
  Semitones = sliceImage(semitoneimg, 5, 12);

  // Load Sound Files
  Promise.all(SOUNDS.map(function (s) {return s.load()})).then(function (all) {
    all.map(function (buffer, i) {
      SOUNDS[i].buffer = buffer;
    });
    // Save system sounds
    SysSnd.endmark = SOUNDS[15];
    SysSnd.bomb    = SOUNDS[16];
    SysSnd.click   = SOUNDS[17];
    SysSnd.undo    = SOUNDS[18];
    SysSnd.clear   = SOUNDS[19];
    // Overwrite from 15 for convinience
    SOUNDS[15] = MikuEntity;
    SOUNDS[15].num = 15;
    SOUNDS[15].image = bimgs[15];
    SOUNDS[15].minic = minis[15];
    for (var i = 16; i < 31; i++) {
      SOUNDS[i] = new MIDIEntity(i - 15, (i - 16) * 8);
      SOUNDS[i].num = i;
      SOUNDS[i].image = bimgs[i];
      SOUNDS[i].minic = minis[i];
    }

    CONSOLE.removeChild(document.getElementById("spinner"));

    if (Object.keys(OPTS).length == 0) return;

    if (OPTS['url'] != undefined) {
      fullInitScore();
      var url = OPTS['url'];
      new Promise(function (resolve, reject) {
        var req = new XMLHttpRequest();
        req.open('GET', url);
        req.onload = function() {
          if (req.status == 200) {
            resolve(req.response);
          } else {
            reject(Error(req.statusText));
          }
        };

        req.onerror = function() {
          reject(Error("Network Error"));
        };

        req.send();
      }).then(function(response) {
        var msq = false;
        if (url.slice(-3) == "msq")
          addMSQ(response);
        else
          addJSON(response);

        closing();

        autoPlayIfDemanded(OPTS);

      }).catch(function (err) {
        alert("Downloading File: " + url + " failed :" + err);
        console.error("Downloading File: " + url + " failed :" + err.stack);
      })
    } else if (OPTS.S != undefined || OPTS.SCORE != undefined) {
      var score = OPTS.SCORE || OPTS.S;
      var tempo = OPTS.TEMPO || OPTS.T;
      var loop  = (OPTS.LOOP  || OPTS.L);
      var end   = OPTS.END   || OPTS.E;
      var beats = (OPTS.TIME44 || OPTS.B);

      if (tempo == undefined || loop == undefined || end == undefined ||
          beats == undefined) {
        throw new Error("Not enough parameters");
      }

      loop  = loop.toUpperCase();
      beats = beats.toUpperCase();

      var text = "SCORE=" + score + "\n" +
                 "TEMPO=" + tempo + "\n" +
                 "LOOP=" + ((loop == "T" || loop == "TRUE") ? "TRUE" : "FALSE") + "\n" +
                 "END=" + end + "\n" +
                 "TIME44=" + ((beats == "T" || beats == "TRUE") ? "TRUE" : "FALSE");
      fullInitScore();
      addMSQ(text);
      closing();

      autoPlayIfDemanded(OPTS);
    }
  }).catch(function (err) {
    alert("Invalid GET parameter :" + err);
    console.error("Invalid GET parameter :" + err.stack);
  });

  // Should use SCREEN instead of document?
  document.addEventListener('keydown', handleKeyboard);

  requestAnimFrame(doAnimation);

  var b = document.getElementById("magnify");
  b.addEventListener("change", selectListener);
}

function handleKeyboard(e) {
//  console.log("e.keyCode = " + e.keyCode);
//  console.log("e.shiftKey = " + e.shiftKey);
  if (document.activeElement.id == "lyric") return;

  // WARNING: r's properties are STRING! Check Implicit type change
  var r = document.getElementById('scroll');
  switch (e.keyCode) {
    case 32: // space -> play/stop or restart with shift
      var playBtn = document.getElementById('play');
      if (playBtn.disabled == false || e.shiftKey) {
        playListener.call(playBtn, e);
      } else {
        stopListener.call(document.getElementById('stop'), e);
      }
      e.preventDefault();
      break;

    // r.value is limited between r.min and r.max
    // So you don't have to check the limit value here
    // If you put String into CurPos, it fails.
    case 37: // left -> scroll left
    case 188:
      r.value = CurPos - 1;
      CurPos = parseInt(r.value);
      e.preventDefault();
      break;

    case 39: // right -> scroll right
    case 190:
      r.value = CurPos + 1;
      CurPos = parseInt(r.value);
      e.preventDefault();
      break;

    case 34: // Page Down
    case 221:
    case 79:
      r.value = CurPos + 8;
      CurPos = parseInt(r.value);
      e.preventDefault();
      break;
    case 33: // Page Up
    case 219:
    case 73: 
      r.value = CurPos - 8;
      CurPos = parseInt(r.value);
      // I need to use Ctrl + Shift + I for debugger!!
      if (!(e.shiftKey && e.ctrlKey)) e.preventDefault();
      break;

    case 81: // Reset note length
      setNoteLength(0);
      e.preventDefault();
      break;
    case 87: // Make note length 0   Note Off
      setNoteLength(1);
      e.preventDefault();
      break;
    case 69: // Make note length 0.5 Staccato
      setNoteLength(2);
      e.preventDefault();
      break;

    case 187: // Octave Up
      changeNoteOctave(12);
      e.preventDefault();
      break;
    case 189: // Octave Down
      changeNoteOctave(-12);
      e.preventDefault();
      break;

    case 84: // T: Test Play
      if (GameStatus != 0) break;
      e.preventDefault();
      testPlayListener(e.shiftKey);
      break;

    case 8: // Ignore Backspace key to avoid go previous page!
      e.preventDefault();
      break;
  }
}

// Test Play Listener:
//   When user push 't', A runner plays the part of the score only on the screen.
//   When user push shift + 'T', it will continue playing by changing CurPos.
function testPlayListener(isShift) {
  SysSnd.click.play(65);

  // Clear MIDI condition
  if (MIDIOUT) MIDIOUT.stopAll();

  GameStatus = 4; // Without Enter, nor Leave
  if (AnimeID != 0) cancelAnimationFrame(AnimeID);
  Runner.init4testPlay();

  var barnum = CurPos - 2;

  // Reload reserved lyrics if we need to.
  // ToDo: Conditions have be reviewed.
  var curLyric = document.getElementById("lyric").value;
  if (MikuEntity.lyric != curLyric) {
    MikuEntity.lyric = curLyric;
    MikuEntity.parseLyrics();
    var keys = Object.keys(MikuEntity.commands).sort(function (a,b) {return b-a});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] <= barnum) {
        var cmds = MikuEntity.commands[keys[i]];
        for (var j = 0; j < cmds.length; j++) {
          doCommand(cmds[j]);
        }
        break;
      }
    }
  }

  // Reset MikuMemo and MikuPSMemo
  initMikuMemo();
  if (barnum < 0) barnum = 0;
  MikuEntity.idxL = undefined;
  for (; barnum < CurScore.notes.length; barnum++) {
    MikuEntity.idxL = MikuMemo[barnum];
    if (MikuEntity.idxL != undefined) break;
  }
  MikuEntity.doremiMode = (MikuEntity.idxL == undefined);


  var pos = MikuPSMemo[barnum];
  if (pos != undefined) {
    MikuEntity.changeSlot((pos >> 6) + 1);
    MikuEntity.numOfChars = pos % 64;
    if (pos != 0) MikuEntity.changeLyricPosition(pos % 64);
  }

  if (isShift) {
    var pb = document.getElementById('play');
    pb.disabled = true;
    pb.style.backgroundImage = "url(" + pb.images[1].src + ")";
    var sb = document.getElementById('stop');
    sb.style.backgroundImage = "url(" + sb.images[0].src + ")";
    sb.disabled = false;
    requestAnimFrame(doRunnerTestPlayNonStop);
  } else
    requestAnimFrame(doRunnerTestPlay);
}

function doRunnerTestPlay(timeStamp) {
  bombTimer.checkAndFire(timeStamp);
  if (Runner.x < ORGWIDTH) {
    Runner.testPlay(timeStamp);
    AnimeID = requestAnimFrame(doRunnerTestPlay);
    return;
  }
  GameStatus = 0;
  if (MIDIOUT) MIDIOUT.stopAll();
  requestAnimFrame(doAnimation);
}

function doRunnerTestPlayNonStop(timeStamp) {
  bombTimer.checkAndFire(timeStamp);
  if (Runner.pos - 2 >= CurScore.end -1) {
    GameStatus = 0;
    stopListener.call(document.getElementById('stop'));
    return;
  }

  if (Runner.x < ORGWIDTH) {
    Runner.testPlay(timeStamp);
  } else {
    CurPos += 8;
    document.getElementById("scroll").value = CurPos;
    Runner.x -= ORGWIDTH;
  }
  AnimeID = requestAnimFrame(doRunnerTestPlayNonStop);
}


function setNoteLength(len) {
  changeNoteProperty(function (a) { // a stands for array
    a[3] = len;
    return a;
  });
}

function changeNoteOctave(diff) {
  changeNoteProperty(function (a) {
    var key = a[1];
    key += diff;
    if (key < 0 || key > 0x7F) key -= diff;
    a[1] = key;
    return a;
  });
}

// change note property:
//   Input fn is a function which changes one or more values in the array.
//  The function's input is array of the properties of a note.
function changeNoteProperty(fn) {
  var realX = MouseX - OFFSETLEFT;
  var realY = MouseY - OFFSETTOP;
  var g = toGrid(realX, realY);
  var gridX = g[0];
  var gridY = g[1];
  var barnum = CurPos + gridX - 2;
  var notes = CurScore.notes[barnum];
  if (notes == undefined || notes.length == 0) return;
  for (var i = notes.length - 1; i >= 0; i--) {
    var note = notes[i];
    if (typeof note == "string") continue;
    var a = decodeNote(note);
    var key    = a[1];
    var isFlat = a[2];
    var scale  = key2GridY(key, isFlat);
    if (scale == gridY) {
      a = fn(a);
      notes[i] = reencodeNote(a[1], a[0], a[2], a[3]);
      SysSnd.click.play(65);
      break;
    }
  }
}

function autoPlayIfDemanded(opts) {
  var auto = opts['a'] || opts['auto'];
  if (auto != undefined) {
    auto = auto.toUpperCase();
    if (auto == "T" || auto == "TRUE")
      document.getElementById("play").dispatchEvent(new Event("click"));
  }
}
// Clear Button Listener
function clearListener(e) {
  this.style.backgroundImage = "url(" + this.images[1].src + ")";
  SysSnd.clear.play(65);
  var self = this;
  function makePromise(num) {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        self.style.backgroundImage = "url(" + self.images[num].src + ")";
        resolve()
      }, 150);
    });
  }

  makePromise(2).then(function () {
    return makePromise(1);
  }).then(function () {
    return makePromise(0);
  }).then(function () {
    initScore();
    CurPos = 0;
  });

  clearSongButtons();
}

// Play Button Listener
function playListener(e) {
  this.style.backgroundImage = "url(" + this.images[1].src + ")";
  SysSnd.click.play(65);
  var b = document.getElementById("stop");
  b.style.backgroundImage = "url(" + b.images[0].src + ")";
  b.disabled = false;
  this.disabled = true; // Would be unlocked by stop button

  ["toLeft", "toRight", "scroll", "clear", "frog", "beak", "1up"].
    map(function (id) {document.getElementById(id).disabled = true;});

  // Clear MIDI condition
  if (MIDIOUT) MIDIOUT.stopAll();

  GameStatus = 1; // Mario Entering the stage
  CurPos = 0;     // doAnimation will draw POS 0 and stop
  Runner.init();
  // Start AFTER writing lyrics
  MikuEntity.initLyric(function() {
    initMikuMemo();
    requestAnimFrame(doRunnerEnter);
  });
}

// Stop Button Listener
function stopListener(e) {
  this.style.backgroundImage = "url(" + this.images[1].src + ")";
  // Sound ON: click , OFF: called by doRunnerPlay
  if (e != undefined) SysSnd.click.play(65);
  var b = document.getElementById("play");
  b.style.backgroundImage = "url(" + b.images[0].src + ")";
  //b.disabled = false; // Do after Mario left the stage
  this.disabled = true; // Would be unlocked by play button

  GameStatus = 3; // Mario leaves from the stage
  Runner.init4leaving();
  if (AnimeID != 0) cancelAnimationFrame(AnimeID);
  requestAnimFrame(doRunnerLeave);
}

// Let Mario run on the stage
function doRunnerEnter(timeStamp) {
  bombTimer.checkAndFire(timeStamp);
  drawScore(0, CurScore.notes, 0);
  Runner.enter(timeStamp);

  if (Runner.x < 40) {
    AnimeID = requestAnimFrame(doRunnerEnter);
  } else {
    Runner.init4playing(timeStamp);
    GameStatus = 2;
    AnimeID = requestAnimFrame(doRunnerPlay);
  }
}

// Let Mario play the music!
function doRunnerPlay(timeStamp) {
  bombTimer.checkAndFire(timeStamp);
  Runner.play(timeStamp);
  if (GameStatus == 2) {
    if (Runner.pos - 2 != CurScore.end - 1) {
      AnimeID = requestAnimFrame(doRunnerPlay);
    } else if (CurScore.loop) {
      CurPos = 0;
      Runner.pos = 1;
      Runner.x = 40;
      Runner.init4playing(timeStamp);
      AnimeID = requestAnimFrame(doRunnerPlay);
    } else {
      // Calls stopListener without a event arg
      stopListener.call(document.getElementById('stop'));
    }
  }
}

// Let Mario leave from the stage
function doRunnerLeave(timeStamp) {
  bombTimer.checkAndFire(timeStamp);
  drawScore(CurPos, CurScore.notes, Runner.scroll);
  Runner.leave(timeStamp);

  if (Runner.x < 247) {
    requestAnimFrame(doRunnerLeave);
  } else {
    GameStatus = 0;

    ["toLeft", "toRight", "scroll", "play", "clear", "frog", "beak", "1up"].
      map(function (id) {
        document.getElementById(id).disabled = false;
      });

    // Clear MIDI output
    if (MIDIOUT) MIDIOUT.stopAll();
    MikuEntity.doremiMode = true;

    // When stop, close your mouth!
    if (CurSong != undefined) {
      CurSong.style.backgroundImage =
        "url(" + CurSong.images[1].src + ")";
    }

    requestAnimFrame(doAnimation);
  }
}

// Clear Song Buttons
function clearSongButtons() {
  ['frog','beak','1up'].map(function (id, idx) {
    var b = document.getElementById(id);
    b.disabled = false;
    b.style.backgroundImage = "url(" + b.images[0].src + ")";
  });
  CurSong = undefined;
}

// Clear Eraser Button
function clearEraserButton() {
  var b = document.getElementById('eraser');
  b.style.backgroundImage = "url(" + b.images[0].src + ")";
  eraserTimer.switch = false;
}

// Full Initialize Score
// - Just for file loading...
function fullInitScore() {
  CurScore.notes = [];
  CurMaxBars = 0;
  CurScore.beats = 4;
  // Loop button itself has a state, so keep current value;
  // CurScore.loop = false;
  CurScore.end = 0;
  CurScore.tempo = 0;
  MikuMemo = [0];
  MikuEntity.slot = undefined;
  MikuEntity.commands = [];
}

// Initialize Score
function initScore() {
  var tmpa = [];
  for (var i = 0; i < DEFAULTMAXBARS; i++) tmpa[i] = [];
  CurScore.notes = tmpa;
  CurMaxBars = DEFAULTMAXBARS;
  var s = document.getElementById("scroll");
  s.max = DEFAULTMAXBARS - 6;
  s.value = 0;
  CurScore.loop = false;
  document.getElementById("loop").reset();
  CurScore.end = DEFAULTMAXBARS - 1;
  CurScore.tempo = DEFAULTTEMPO;
  document.getElementById("tempo").value = DEFAULTTEMPO;
  CurScore.beats = 4;
  var e = new Event("click");
  e.soundOff = true;
  document.getElementById("4beats").dispatchEvent(e);
  MikuMemo = [0];
  MikuEntity.slot = undefined;
  MikuEntity.commands = [];
  document.getElementById("lyric").value = "";
}

// Easiest and Fastest way to clone
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// sliceImage(img, width, height)
//   img: Image of the sprite sheet
//   width: width of the Character
//   height: height of the Charactter
function sliceImage(img, width, height, mag) {
  var magnify = mag || MAGNIFY;
  var result = [];
  var imgw = img.width * magnify;
  var imgh = img.height * magnify;
  var num = Math.floor(img.width / width);
  var all = num * Math.floor(img.height / height);
  var charw = width * magnify;
  var charh = height * magnify;

  for (var i = 0; i < all; i++) {
    var tmpcan = document.createElement("canvas");
    tmpcan.width  = charw;
    tmpcan.height = charh;
    var tmpctx = tmpcan.getContext('2d');
    tmpctx.imageSmoothingEnabled = false;
    tmpctx.drawImage(img,
      (i % num) * width, Math.floor(i / num) * height,
      width, height, 0, 0, charw, charh);
    var charimg = new Image();
    charimg.src = tmpcan.toDataURL();
    result[i] = charimg;
  }
  return result;
}

// Download Score as JSON
//   http://jsfiddle.net/koldev/cW7W5/
function save() {
  CurScore.lyric = document.getElementById("lyric").value;
  var link = document.createElement("a");
  link.download = 'MSQ_Data.json';
  var json = JSON.stringify(CurScore);
  var blob = new Blob([json], {type: "octet/stream"});
  var url = window.URL.createObjectURL(blob);
  link.href = url;
  link.click();
}

EmbeddedSong = [];
EmbeddedSong[0] = {"notes":[[1100,2368],[1100,2368],[],[1100,2368],[],
  [1096,2364],[1100,2368],[],[1103,2371],[],[],[],[583,3651,320],[],[],[],
  [2892,2888,316],[],[3151,3644],[3151,2892,3644],[2893,2888,316],[],
  [3151,3649],[3151,2893,3651],[2895,2890,316],[],[3151,3651],
  [2895,1347,3644],[2893,1349,1345],[325,1345,1342],[1349,3651,1345],
  [1351,1347,318],[76,3644,3131],[],[335],[333,3644],[72,3648,3131],[],
  [335],[333,67,3648],[69,3649,3131],[72],[335,3649],[333,72,3653],[3131],
  [335],[],[333,69,3651],[67,3131],[3651],[335,72,3649],[333],[72,3648,3131],
  [],[79,3646],[333],[76,3651],[1091],[335,1093],[74,1095,3649],[1096],
  [1098,325],[1100],[1101,323],[1100,318,3644],[67],[2124,72],[67,318,3644],
  [1096,3648,318],[67],[2124,72],[71,1091,3648],[1093,3649,318],
  [1096,69,2625],[72],[77,1096,3653],[321],[2125,76,328],[74,328],[327,1093],
  [1091,318],[3663,76,67],[1096],[77,71,67],[1101,3651],[1100],[1098],[],
  [1096],[332,3656],[],[328,3644],[327,3644],[],[327,316],[]],
  "beats":4,"loop":false,"end":96,"tempo":"370"};

EmbeddedSong[1] = {"notes":[[840,828],[847],[844,828],[847],[840,835],
  [847],[844,835],[847],[840,837],[845],[840,837],[845],[847,844,835],
  [],[],[],[845,837,833],[840],[845,837,833],[840],[844,835,832],[840],
  [844,835,832],[840],[842,839,830],[835],[842,830],[839],[842,832,828],
  [],[],[],[835,832],[847],[835,832],[847],[833,830],[847],[833,830],[847],
  [832,828],[847],[832,828],[847],[830,827],[],[],[],[835],[847,840],[835],
  [847,840],[833],[847,840],[833],[847,840],[832],[847,840],[832],
  [847,840],[842,839,830],[],[],[],[832,828],[828],[832,828],[828],
  [835,832],[832],[835,832],[832],[837,833],[833],[837,833],[833],
  [847,835,832],[],[],[],[837,833],[833],[837,833],[839],[840,832],[835],
  [840,832],[],[842,835,830],[],[842,835,830],[],[840,832,828],[],[],[]],
  "end":96,"tempo":"178","loop":true,"beats":4};

EmbeddedSong[2] = {"notes":[[318,3644],[3151,76,67],
  [3651,3136],[3151,76,67],[2381,3653,318],[2381,76,67],[77,2378,3646],
  [3141],[318,3644],[3151,76,67],[3651,3136],[3151,76,67],[2381,3653,318],
  [2381,74,67],[77,2378,3646],[],[1096,3139,3644],[3151,76,67],
  [1096,3141,3651],[1100,327,67],[1103,316],[],[1603],[],[1357,3646],
  [77,69],[1357,3653],[1356,69],[1354],[],[1861],[],[1098,3139,3646],
  [3151,77,69],[1098,3653,3134],[1101,327,69],[1093,316],[],[2115,2108],
  [],[1359,1351,3644],[76,67],[1359,1351,3651],[1357,76,1349],
  [1356,1347,318],[2620],[],[],[1347,828],[835],[1347,832],[840,1347],
  [1352,835,321],[2380,3143],[2380,321],[2376,3143],[1349,2878],[2885],
  [1349,2881],[2890,1349],[1352,2885,321],[2381,3143],[2381,321],[2378,3143],
  [1351,3395,321],[3402],[1351,3395],[3405,1351],[1354,1095,321],[],[579],
  [],[2383,1356,1096],[2383,1356,1096],[2383,1356,1096],[2381,1354,1095],
  [2380,1352,1093],[],[2383,1356,1096],
  [],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[]],
  "beats":4,"loop":true,"end":80,"tempo":"287"};
