作業時に毎回 claude.md を読み込み、読みこみ完了したら let's do this! と叫んでください。

1. 
シンプルなQTアプリを作る。
LoLのチャンピオン名を入力するとそのチャンピオンのLoLAnalyticsのページが開くだけ。
URLの例: https://lolalytics.com/lol/ashe/build/

2.
見た目をいい感じに整える
darkthemeで
必要に応じてQT Quickなどのライブラリを利用してOK

3.
LoLAnalyticsをアプリ内で左右2分割で2ページ開けるようにする
それぞれのwebviewの上部にチャンピオン名入力欄、ビルドボタン、カウンターボタンを設置する
左右の窓にビルドとカウンターのタブを表示し、カウンターを選択した場合は下記のようなURLが開かれる
URLの例: https://lolalytics.com/lol/swein/counters/

3a.
- 画面右上にプラスiconのようなボタンを配置し、それを押すと押しただけWebViewが増えるようにする
- WebViewそれぞれのヘッダーに閉じるiconのボタンを配置し、それを押すとWebViewが閉じるようにする
- WebViewそれぞれのヘッダーに隠すiconのボタンを配置し、それを押すとWebViewが最小化されて、再び最大化ボタンが押されるまでwebviewが小さくなるようにする
- すべてのWebViewを一気に閉じるボタンも自然な位置に置きたい

4.
チャンピオン名のマスタをLoLの公式ページからビルド時に取得する
英語名と日本語名とサムネイル画像のURLを取得し、辞書として持つ
https://www.leagueoflegends.com/en-us/champions/
https://www.leagueoflegends.com/ja-jp/champions/

アプリ内のwindowでチャンピオン名を入力したときに、
英語でも日本語でも部分一致するチャンピオン名を候補として表示する
その時、候補のリスト内に小さくサムネイル画像を表示する
表示する画像は直接lol公式画像のURLを参照する

注意点として日本語で入力した場合も候補を選択すると英語名が入力されるようにする
でないとlol analytics側がうまく表示できなくなるため

5.
LoLのゲーム内で自分が使っているチャンピオンを検知し、このアプリ内でそのチャンピオンのビルドページが自動で開かれるようにする

7.
LoLのBanPick画面で相手が選択したチャンピオン5体のカウンターページを自動で開かれるようにする
https://lolalytics.com/lol/swein/counters/
