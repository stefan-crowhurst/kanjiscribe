# kanjiscribe notes

The following are notes on this project aligning both intentions and technical decisions

## Overview

kanjiscribe is intended to assist me in the process of drilling kanji to help better memorise words, currently I am doing the following manual process while using Anki:

1. Copy word from Anki, often kinda buggy due to the furigana script
2. Alt-tab into manually created text file and paste word in, manually type in brackets the romaji version of it

Then later when wanting to practice:

1. Copy word from text file
2. Open jisho and search for the word
3. Locate the relevant kanji on the side of the search results, open in new tab, study the writing method and practice
4. Repeat for each word

## Pain points

The main pain point is how manual the whole process is, an ideal solution would have:

- Anki button - A new button which allows for word data to be pulled out and stored for later use
- Anki automation - When "Again" is clicked automatically pull the word data out, may be worth making configurable for other options too
- Manual entry - When I'm on the train/travelling I may not have access to my PC, or I may encounter a word outside of Anki so this is important to have
- Unified UI - A proper UI which shows all relevant information about the word and how to write each kanji in it on a single screen, rather than showing romaji it would be best to show kana relevant to whether it's kunyomi or onyomi for the word

## Nice to haves

- Stats - It'd be good to know which words & kanji appear most often and also how often they appear (their interval) and how that's changed over time, helps to track progress
- Example sentences - It'd be useful to have some example usage pulled in alongside the various definitions in the UI to help it be a one-stop shop for me, effectively I'd like to see all of the information currently shown for each kanji in jisho, minus the translations into other languages they have
- Mobile Anki integration - I believe you can do Anki plugins for mobile too so that would be pretty cool to have

## Technical approach

I've got a few ideas on how to approach this, some are pretty certain, others less so:

### Hosting

This has an obvious answer, it'll go on my raspberry pi on my tailscale network for ease of setup and 0 cost. This application doesn't need to be super high performance and won't be handling immense volumes of data as it is only me using it so this should be sufficient.

### Database

Again, since we're hosting this on the pi and want something fairly simple I think SQLite is perfectly fine here, we don't need anything fancy

In terms of the tables & schemas here I have the following ideas, though they may not be perfect:

#### Word

Stores data about the word

|name|type   |description                                     |
|----|-------|------------------------------------------------|
|id  |varchar|UUID to uniquely identify entry (PK)            |
|text|varchar|The raw word itself                             |

#### Day

The day and relevant statistical data about it

|name     |type|description                                    |
|---------|----|-----------------------------------------------|
|date     |date|The date (PK)                                  |
|completed|bool|Whether every word has been drilled for the day|
|duration|int|The number of seconds spent drilling, derived from words|

THOUGHT: Could we just do completed as a derived thing from the link table instead? Might be easier 

#### DayWord

The link table between a given day and a word

|name     |type   |description                                  |
|---------|-------|---------------------------------------------|
|date     |date   |The date (FK > Day)(PK)                      |
|wordId   |varchar|The UUID for the word (FK > Word)(PK)        |
|completed|bool   |Whether the word has been drilled for the day|
|timeSpent|int|The number of seconds spent on the screen drilling this kanji|

#### Kanji

A table which stores data about a kanji

|name|type|description|
|-|-|-|
|id|varchar|UUID to uniquel identify entry (PK)|
|text|varchar|The kanji symbol itself|


#### KanjiWords

A table which links a word to its kanji

|name|type|description|
|-|-|-|
|word|varchar|The linked word (FK > Word)(PK)|
|kanji|varchar|The linked kanji (FK > Kanji)(PK)|

### API

Since we'll need an API for this we can simply host that on the raspberry pi on the tailscale network as well, since it's not a complex project I think a basic express api should work for this

There should be appropriate endpoints for both updating the data here based on the user journey and consuming it at a later point.

### Frontend

Again we don't need anything particularly complicated here, a simple frontend application built on vite should be able to serve our needs here, it will again be hosted on the raspberry pi

The frontend application should have a homepage which displays some basic statistics such as average duration/number of words per day as well as the total amount of time spent. It would also be good to show a "heatmap" style calendar where days are represented by small squares which are filled in green when completed. On hovering over each of these squares it should show the user how long they spent and how many words they wrote that day, the more words the lighter green it becomes, think like the commit chart that's on a user's github profile. The homepage should also have a section which reminds the user to complete any days which they have not yet already completed.

When drilling for a given day a timer should be displayed at the bottom of the screen for how long has been spent on that given word, next to it should be a complete button which marks that word as complete and moves onto the next for that day. The main area of the page above this should display the word clearly at the top of the page in furigana script, next to this the english definition of the word should be shown. Beneath this there should be sections for each kanji, this should show the kanji itself, its list of definitions and a series of images showing the writing process. Generally the UI for each word/kanji should be similar to the respective UI on jisho.org.

In terms of design it should be simple enough (just CSS), but would be nice to have some traditional japanese flair to it

Should be responsive for mobile/tablet/PC support

### General

We should use typescript and follow industry standards

We should use zod for data parsing/validation

We should use a monorepo with shared types/schemas to make communication between system components easier

For a first phase don't make the Anki plugin, just focus on the webapp/api/db and can then integrate that at a later date once research into how to develop those is completed

## Thoughts

I'm wondering, since we're wanting to make use of a lot of the jisho.org-style UI could we just iframe the relevant pages in instead? This would save having to try and source data

If this isn't possible where do we source this data? I know jisho.org makes use of a lot of open source resources so maybe we'd be able to do much the same?
