import { describe, expect, it } from 'vitest';

import { toRomajiForm } from './romaji.js';

describe('toRomajiForm', () => {
  it('converts the gojūon base table', () => {
    expect(toRomajiForm('あいうえお')).toBe('aiueo');
    expect(toRomajiForm('かきくけこ')).toBe('kakikukeko');
    expect(toRomajiForm('がぎぐげご')).toBe('gagigugego');
    expect(toRomajiForm('さしすせそ')).toBe('sashisuseso');
    expect(toRomajiForm('ざじずぜぞ')).toBe('zajizuzezo');
    expect(toRomajiForm('たちつてと')).toBe('tachitsuteto');
    expect(toRomajiForm('だぢづでど')).toBe('dajizudedo');
    expect(toRomajiForm('なにぬねの')).toBe('naninuneno');
    expect(toRomajiForm('はひふへほ')).toBe('hahifuheho');
    expect(toRomajiForm('ばびぶべぼ')).toBe('babibubebo');
    expect(toRomajiForm('ぱぴぷぺぽ')).toBe('papipupepo');
    expect(toRomajiForm('まみむめも')).toBe('mamimumemo');
    expect(toRomajiForm('やゆよ')).toBe('yayuyo');
    expect(toRomajiForm('らりるれろ')).toBe('rarirurero');
    expect(toRomajiForm('わゐゑを')).toBe('waieo');
    expect(toRomajiForm('ん')).toBe('n');
    expect(toRomajiForm('ゔ')).toBe('vu');
  });

  it('converts small kana', () => {
    expect(toRomajiForm('ぁぃぅぇぉ')).toBe('aiueo');
    expect(toRomajiForm('ゃゅょ')).toBe('yayuyo');
    expect(toRomajiForm('ゎ')).toBe('wa');
    expect(toRomajiForm('ゕゖ')).toBe('kake');
  });

  it('converts yōon combinations', () => {
    expect(toRomajiForm('きゃきゅきょ')).toBe('kyakyukyo');
    expect(toRomajiForm('しゃしゅしょ')).toBe('shashusho');
    expect(toRomajiForm('ちゃちゅちょ')).toBe('chachucho');
    expect(toRomajiForm('にゃにゅにょ')).toBe('nyanyunyo');
    expect(toRomajiForm('ひゃひゅひょ')).toBe('hyahyuhyo');
    expect(toRomajiForm('みゃみゅみょ')).toBe('myamyumyo');
    expect(toRomajiForm('りゃりゅりょ')).toBe('ryaryuryo');
    expect(toRomajiForm('ぎゃぎゅぎょ')).toBe('gyagyugyo');
    expect(toRomajiForm('じゃじゅじょ')).toBe('jajujo');
    expect(toRomajiForm('ぢゃぢゅぢょ')).toBe('jajujo');
    expect(toRomajiForm('びゃびゅびょ')).toBe('byabyubyo');
    expect(toRomajiForm('ぴゃぴゅぴょ')).toBe('pyapyupyo');
  });

  it('converts the common foreign combinations', () => {
    expect(toRomajiForm('ふぁふぃふぇふぉ')).toBe('fafifefo');
    expect(toRomajiForm('てぃでぃ')).toBe('tidi');
    expect(toRomajiForm('しぇじぇちぇ')).toBe('shejeche');
    expect(toRomajiForm('うぃうぇうぉ')).toBe('wiwewo');
    expect(toRomajiForm('ゔぁゔぃゔぇゔぉ')).toBe('vavivevo');
  });

  it('renders ぢ as ji, づ as zu, and を as o', () => {
    expect(toRomajiForm('ぢ')).toBe('ji');
    expect(toRomajiForm('づ')).toBe('zu');
    expect(toRomajiForm('を')).toBe('o');
  });

  it('converts whole words', () => {
    expect(toRomajiForm('たべる')).toBe('taberu');
    expect(toRomajiForm('ごじゅう')).toBe('gojuu');
  });

  it('doubles the following consonant for っ', () => {
    expect(toRomajiForm('まっちゃ')).toBe('matcha');
    expect(toRomajiForm('いっしょ')).toBe('issho');
    expect(toRomajiForm('みっつ')).toBe('mittsu');
    expect(toRomajiForm('がっこう')).toBe('gakkou');
    expect(toRomajiForm('きって')).toBe('kitte');
  });

  it('drops っ before a vowel or at the end', () => {
    expect(toRomajiForm('あっ')).toBe('a');
    expect(toRomajiForm('っ')).toBeNull();
  });

  it('renders ん as n always', () => {
    expect(toRomajiForm('しんぶん')).toBe('shinbun');
    expect(toRomajiForm('しんいち')).toBe('shinichi');
    expect(toRomajiForm('こんにちは')).toBe('konnichiha');
  });

  it('repeats the preceding vowel for ー', () => {
    expect(toRomajiForm('コーヒー')).toBe('koohii');
    expect(toRomajiForm('ラーメン')).toBe('raamen');
    expect(toRomajiForm('アー')).toBe('aa');
    expect(toRomajiForm('んー')).toBe('n');
  });

  it('keeps long vowel kana sequences literal', () => {
    expect(toRomajiForm('とうきょう')).toBe('toukyou');
    expect(toRomajiForm('せんせい')).toBe('sensei');
    expect(toRomajiForm('おばあさん')).toBe('obaasan');
  });

  it('expands iteration marks, voicing the repeated kana for ゞ', () => {
    expect(toRomajiForm('すゞ')).toBe('suzu');
    expect(toRomajiForm('かゝ')).toBe('kaka');
    expect(toRomajiForm('かゞ')).toBe('kaga');
    expect(toRomajiForm('カヽ')).toBe('kaka');
    expect(toRomajiForm('スヾ')).toBe('suzu');
  });

  it('repeats a whole yōon mora for iteration marks', () => {
    expect(toRomajiForm('きゃゝ')).toBe('kyakya');
    expect(toRomajiForm('しゃゞ')).toBe('shaja');
    expect(toRomajiForm('シャヽ')).toBe('shasha');
  });

  it('expands ゟ to yori', () => {
    expect(toRomajiForm('ゟ')).toBe('yori');
  });

  it('folds the katakana yōon twins ヷヸヹヺ', () => {
    expect(toRomajiForm('ヷヸヹヺ')).toBe('vavivevo');
  });

  it('normalises halfwidth katakana with NFKC', () => {
    expect(toRomajiForm('ﾀﾋ')).toBe('tahi');
    expect(toRomajiForm('ｺｰﾋｰ')).toBe('koohii');
  });

  it('drops punctuation and separators', () => {
    expect(toRomajiForm('・〜、。＝')).toBeNull();
    expect(toRomajiForm('～')).toBeNull();
    expect(toRomajiForm('a・b')).toBe('ab');
  });

  it('passes unknown characters through lowercased', () => {
    expect(toRomajiForm('ABC')).toBe('abc');
    expect(toRomajiForm('123')).toBe('123');
    expect(toRomajiForm('漢字')).toBe('漢字');
  });

  it('returns null for degenerate readings', () => {
    expect(toRomajiForm('')).toBeNull();
    expect(toRomajiForm('ー')).toBeNull();
    expect(toRomajiForm('〜')).toBeNull();
    expect(toRomajiForm('ゝ')).toBeNull();
    expect(toRomajiForm('ヾ')).toBeNull();
    expect(toRomajiForm('=')).toBeNull();
  });
});
