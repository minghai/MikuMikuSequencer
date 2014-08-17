Miku Miku Sequencer
====

This is good old Mario Sequencer Web Edition.

Original software for Windows 95 by Anonymous in 2ch:
http://www.geocities.jp/it85904/mariopaint_mariosequencer.html

Works only on Chrome (at least for now).

This new version now supports GAKKEN NSX-39 and sings a song!
NSX-39 a.k.a Pocket Miku is a MIDI instrument which has 1 chip
vocaloid Hatsune Miku and 128 GM MIDI instruments.

More info about NSX-39 and how to order it, please refer this page.
[Gakken NSX-39 "Pocket Miku"](http://www.muffwiggler.com/forum/viewtopic.php?t=114420&sid=3db13b770cbb91faeb24baf78557b37e)

This version of program requires NSX-39 to play. If you don't have one,
please use Mario sequencer instead.
http://github.com/minghai/MarioSequencer

or you can watch how it works with youtube.

[![How to use Miku Miku Sequencer](http://img.youtube.com/vi/IrYH8zE_MbE/0.jpg)](http://www.youtube.com/watch?v=IrYH8zE_MbE)

[![Niko Niko suite - song by Pocket Miku](http://img.youtube.com/vi/2OqES2EnTP8/0.jpg)](http://www.youtube.com/watch?v=2OqES2EnTP8)

[!["You" from Higurashi no naku koro ni - song by Pocket Miku](http://img.youtube.com/vi/mAFiZRwELOk/0.jpg)](http://www.youtube.com/watch?v=mAFiZRwELOk)
http://www.youtube.com/watch?v=mAFiZRwELOk


How to use
------
Direct link to the web app:
http://minghai.github.io/MikuMikuSequencer

Also, here's GREAT music "NikoNiko suite" by Phenix.
http://minghai.github.io/MikuMikuSequencer/?url=NikoNiko_suite.json&auto=true

(WARN: You have to have NSX-39 connected with your PC. And at only 1st execution,
you have to agree for a diagram asking you for a permission to use MIDI SysEx.)

Basically, What you see is what you get.

Select instruments with the buttons on the top of the screen.
Most right button is not a instrument, but when you click this blue thing,
the instruments page changes and you will be choose another 15 instruments.
There are 30 instruments. First 15 are WAV sounds. The others are MIDI instruments.
Last 15 instruments are actually mapped to MIDI channel 1 to 15.
Channel 1 is special for Miku to sing.
Channel 10 is special for drum map. You can use many percussions by this channel.
Other channels are free to choose instruments by Commands. I'll describe about commands later.

After selecting the instrument, put notes on the score as you like
by left click.
If you need to scroll the score to left or right, use the scroll
range object.

If you want to delete the notes, select the eraser on the bottom of
the screen, or just use right click on the target note.

The "save" button will save your music as JSON file.
Drag and drop your file and you can play it again.

This version lacks Undo implementation.
Watch out, no Undo. So save many times.

This web app supports both JSON score files and MSQ files for Mario Sequencer for Windows.
Just drag and drop MSQ files, they will be concatinated, and you can save it as one JSON file.
Please number files such as file1.msq, file2.msq .... fileN.msq.
If you want to change the tempo in the middle of the music, separate files,
drag and drop all, then player will remain the tempo of each score and 
change the tempo automatically.

You can use # and b for semitones. Just push Shift and Ctrl key while you left click.

Feel free to make your local clone.
You can use this appli without internet after download them all.

(Do you know Mario Composer file format? Or can you contribute that for me? :-)

MIDI note
-------

Each MIDI note has properties.

1. Length
  - Default is infinite, or non-stop. Most used one is 0, or key off. The rest is 0.5 for staccato.
2. Octave
  - Key of a note is specified by its position on the score, but if you need more higher or lower note, you can specify the octave property relatively higher or lower by octave.
3. Semitone
  - You can semitones such as sharp or flat. Semitones are represented with symbols, though if you specify such like B# or Fb, then its position move to C or E.

There might be note's volume (or velocity) as a note's propety, though it is not implemented yet.


Keyboard
--------

Here I describes what key you can use to edit score or control this app.

- PgUp and PgDn, [ and ], or I and O
  * Scroll up or down the score.
- \< and \>, or left arrow key and right arrow key
  * Move left or right the score only for 1 bar.
- w
  * Aim a note with cursor, then push *w* means key off. Only for MIDI note.
- e
  * Aim a note with cursor, then push *e* means its length will be 0.5 for staccato.
- q
  * Aim a note with cursor, then push *q* means note's length will be default, or infinite.
- Plus and Minus
  * Aim a note with cursor, then push plus or minus means octave up or down.
- Shift
  * If you keep pushing Shift key while you left click to put a note, the note will have sharp.
- Ctrl
  * If you keep pushing Ctrl key while you left click to put a note, the note will have flat.
- T
  * Test play. It will play only the notes on the current screen, or 8 bars.
- Shift + T
  * Test play. It will start playing from the notes on the current screen to the end of the score.


If you octave up or down a note, the note might just move up or down if it can in the score area.


Lyrics
------

Unfortunately, NSX-39 can sing only in Japanese. The latest Hatsune Miku v3 for desktop
has a library for English and sing a English song. So maybe, the future one chip vocaloid
will be able to sing English songs, as I wish.

So you have to input lyrics with only Japanese characters, Hiragana.

You can input lyrics for Miku to sing along into the textarea, right side of the screen.
You have to input the lyric not as usual Japanese, but as you mean to pronounce.

For example,

- ‚Ü‚Î‚½‚«‚µ‚Ä‚Í ¨ ‚Ü‚Î‚½‚«‚µ‚Ä‚í
- ‚¢‚«‚½‚¢ ¨ ‚ä‚«‚½‚¢

You can use only permitted Hiragana for NSX-39.
Only 128 Hiragana in the below table.

|@|0|1|2|3|4|5|6|7|8|9|A|B|C|D|E|F|
|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|
|0|‚ |‚¢|‚¤|‚¦|‚¨|‚©|‚«|‚­|‚¯|‚±|‚ª|‚¬|‚®|‚°|‚²|‚«‚á|
|1|‚«‚ã|‚«‚å|‚¬‚á|‚¬‚ã|‚¬‚å|‚³|‚·‚¡|‚·|‚¹|‚»|‚´|‚¸‚¡|‚¸|‚º|‚¼|‚µ‚á|
|2|‚µ|‚µ‚ã|‚µ‚¥|‚µ‚å|‚¶‚á|‚¶|‚¶‚ã|‚¶‚¥|‚¶‚å|‚½|‚Ä‚¡|‚Æ‚£|‚Ä|‚Æ|‚¾|‚Å‚¡|
|3|‚Ç‚£|‚Å|‚Ç|‚Ä‚ã|‚Å‚ã|‚¿‚á|‚¿|‚¿‚ã|‚¿‚¥|‚¿‚å|‚Â‚Ÿ|‚Â‚¡|‚Â|‚Â‚¥|‚Â‚§|‚È|
|4|‚É|‚Ê|‚Ë|‚Ì|‚É‚á|‚É‚ã|‚É‚å|‚Í|‚Ð|‚Ó|‚Ö|‚Ù|‚Î|‚Ñ|‚Ô|‚×|
|5|‚Ú|‚Ï|‚Ò|‚Õ|‚Ø|‚Û|‚Ð‚á|‚Ð‚ã|‚Ð‚å|‚Ñ‚á|‚Ñ‚ã|‚Ñ‚å|‚Ò‚á|‚Ò‚ã|‚Ò‚å|‚Ó‚Ÿ|
|6|‚Ó‚¡|‚Ó‚ã|‚Ó‚¥|‚Ó‚§|‚Ü|‚Ý|‚Þ|‚ß|‚à|‚Ý‚á|‚Ý‚ã|‚Ý‚å|‚â|‚ä|‚æ|‚ç|
|7|‚è|‚é|‚ê|‚ë|‚è‚á|‚è‚ã|‚è‚å|‚í|‚¤‚¡|‚¤‚¥|‚¤‚§|‚ñ\|‚ñm|‚ñ|‚ñj|‚ñn|

You can ignore top and left numbers. They are just for programmers.
As you can see, this table looks a bit different from usual hiragana table.
For example, "‚µ" is replaced with "‚·‚¡", this means you may use "‚·‚¡" for "‚µ" for better
pronounciation. But if you are a beginner of Vocaloid, just ignore it for a while. That might
not be a problem.
You can see there is not "‚ð", but you can use "‚¤‚§". But this program replace it automatically,
so you can use "‚ð" as usual.

There are 5 kinds of "‚ñ" in the table, but this program's parser can't use all of them but only "N". Rest of them will be supported in the near future. ;-)

# Put the multi chars on a note

When you input lyrics, you can use "(" and ")" to put them on one note.
For example, u(‚±‚ñ)‚É‚¿‚Ív uses 4 notes, not 5 notes.
Especially, "‚ñ" will not be given its own note so you will use this feature for it lots of the cases. But even then, you can still succeeding notes on the same level in many cases. Choose better way for better expressions.

# Reserve lyrics for future use
Pocket Miku has 16 slots for lyrics. Each of them can have 64 Hiragana characters.
So the max number of characters is 1024. But slot 0 is inmemory slot and it disappears soon,
so this program avoid using slot 0. Because of this reason, the max is 960.

960 is good enough for most of all songs, but exceptions such as NikoNiko suite are there.
So, you can use "{" and "}" for lyrics reservation.
Reserved lyrics are not written into PokeMiku when the play starts, but you can write it
when you'd like to with a command which is described below.

This is useful feature. But it requires around 220[ms] for writing lyrics into the slots.
So it requires 3.3[s] for the max and you can't use MIDI note while writing lyrics.
You can play the music with WAV notes among that.

# commands

Commands are written in your lyrics. Your lyrics will be parsed line by line.
Each line starts with "@" and "#" will be treated as command line, thus not written as lyrics
into PocketMiku.

"@" spcifies the number of bars at which the command runs.
The number begins with 0.
You can see numbers on the bar in edit mode. That numbers are
counts for 3 or 4 beats. So you have to multiply the number - 1 with 3 or 4.

"#" declares start of the command. Command is structed with a name and args. You have to
delimiter the name and the args with spaces.

These are the commands we have now.

|Command Name|Description|
|ChangeSlot|Take a positive integer as an argument and change the current slot to the number. Current character position will be the head of that slot. An argument must be from 0 to 15.|
|ChangeLyricPosition|Take a positive integer as an argument and change the current lyrics character position to the number. An argument must be from 0 to 63.|
|WriteReservedLyrics|Take a positive integer as an argument and write the-number-th reserved lyrics into Pocket Miku. It will need about 220[ms] in average time for a slot, and max 15 slots requires about 3.3[s] and you can't use MIDI notes while writing. So be carefule to use this.|
|ChangeProgram|Take two positive integer as arguments. 1st argument specifies MIDI channel, 2nd argument specifies MIDI program. See what kind of instrument you can use from MIDI GM spec.|

# Examples
1. @1424 #WriteReservedLyrics 0
  - This will write a reserved lyrics at the bar 1424.
2. #ChangeProgram 1 127
  - This will change the program for MIDI channel "2" to 127, or sound of firing pistol.

You should care that this program uses 0 origin for numbers so that channel must be from 0 to 14.

When you don't use "@", the program immediately run the commands when it parses your lyrics.


WEB API
-------

There's some WEB API.

- ?url="json or msq file URI"

You can download the score file by this.

- ?auto="true or false"

You can play the music automatically by this.

- ?mag="integer N > 0"

If you believe "The bigger, the better", Go for it!

- ?SCORE="MSQ's sore data"

You can pass the score data by this.

Try these links for example.

  Kerby's OP theme. http://bit.ly/1iuFZs1 
  Aunt Spoon (or Mrs.Pepper Pot) http://bit.ly/1kpLFsd

License
------
This comes from good old SNES game, Mario Paint.
Images and sounds belong to Nintendo.

All code is my original. Written in HTML + JavaScript.
I declare the code in this web app as Public Domain.
Only code, not images and sounds.
Do what you want with my code.
But I'm not responsible for anything, in any means.

Acknowledgement
-----

- Anonymous Mario Sequencer developer in 2ch.

- Phenix who made great music with Mario Sequencer.

  http://phenix2525.blog79.fc2.com/blog-entry-6.html

- Mario Composer Developer

  Similar Mario Paint simulator for Win and Mac

  Developed with Adobe Director

  I owed the idea of Shift and Ctrl click for semitones

- it859 who made MSQ file archive

  http://it859.fc2web.com/mariopaint/mariopaint_music.html#m-2

- Internet Archive

  You really help me a lot for downloading old and disappeared files.

- Simon Whiataker

  "Fork me on GitHub" ribbon in pure CSS. Great work!

  https://github.com/simonwhitaker/github-fork-ribbon-css

Thank you all!
