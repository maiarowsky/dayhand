<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1" language="ja" sourcelanguage="en">
<context>
    <name>ConnectDialog</name>
    <message>
        <source>Connect to your server</source>
        <translation>サーバーに接続</translation>
    </message>
    <message>
        <source>On a computer signed in to your server, run dayhand pair and type the code it shows, or open the link it prints. The code works once, for 10 minutes.</source>
        <translation>サーバーにサインイン済みのコンピューターで dayhand pair を実行し、表示されたコードを入力するか、出力されたリンクを開いてください。コードは1回だけ、10分間有効です。</translation>
    </message>
    <message>
        <source>Server address</source>
        <translation>サーバーのアドレス</translation>
    </message>
    <message>
        <source>Pairing code</source>
        <translation>ペアリングコード</translation>
    </message>
    <message>
        <source>Not Now, Use Dayhand Offline</source>
        <translation>今はしない（オフラインで使う）</translation>
    </message>
    <message>
        <source>Connect</source>
        <translation>接続</translation>
    </message>
</context>
<context>
    <name>DevicePairing</name>
    <message>
        <source>That is not a server address. It looks like https://&lt;name&gt;.convex.site.</source>
        <translation>サーバーのアドレスではありません。https://&lt;name&gt;.convex.site の形式です。</translation>
    </message>
    <message>
        <source>A pairing code has 12 letters and digits, like E6M8-FE02-XSNT.</source>
        <translation>ペアリングコードは英数字12文字です（例: E6M8-FE02-XSNT）。</translation>
    </message>
    <message>
        <source>The code is wrong, used or expired. Run dayhand pair again for a new one.</source>
        <translation>コードが間違っているか、使用済みか、期限切れです。もう一度 dayhand pair を実行して新しいコードを取得してください。</translation>
    </message>
    <message>
        <source>Too many wrong codes on this server. Try again in a few minutes.</source>
        <translation>このサーバーで間違ったコードが多すぎます。数分後にもう一度お試しください。</translation>
    </message>
    <message numerus="yes">
        <source>Too many wrong codes on this server. Try again in %n min.</source>
        <translation>
            <numerusform>このサーバーで間違ったコードが多すぎます。%n 分後にもう一度お試しください。</numerusform>
        </translation>
    </message>
    <message numerus="yes">
        <source>Too many wrong codes on this server. Try again in %n s.</source>
        <translation>
            <numerusform>このサーバーで間違ったコードが多すぎます。%n 秒後にもう一度お試しください。</numerusform>
        </translation>
    </message>
    <message>
        <source>The server cannot be reached. Check the address and the network.</source>
        <translation>サーバーに接続できません。アドレスとネットワークを確認してください。</translation>
    </message>
    <message>
        <source>Something answered at that address, but it is not a Dayhand server.</source>
        <translation>そのアドレスで応答がありましたが、Dayhand サーバーではありません。</translation>
    </message>
    <message>
        <source>The server has a problem. Try again later.</source>
        <translation>サーバーに問題があります。後でもう一度お試しください。</translation>
    </message>
    <message>
        <source>The sign-in could not be saved in the keyring (is a Secret Service such as gnome-keyring running?).</source>
        <translation>サインイン情報をキーリングに保存できませんでした（gnome-keyring などの Secret Service は起動していますか？）。</translation>
    </message>
</context>
<context>
    <name>Formatting</name>
    <message>
        <source>Mon</source>
        <translation>月</translation>
    </message>
    <message>
        <source>Tue</source>
        <translation>火</translation>
    </message>
    <message>
        <source>Wed</source>
        <translation>水</translation>
    </message>
    <message>
        <source>Thu</source>
        <translation>木</translation>
    </message>
    <message>
        <source>Fri</source>
        <translation>金</translation>
    </message>
    <message>
        <source>Sat</source>
        <translation>土</translation>
    </message>
    <message>
        <source>Sun</source>
        <translation>日</translation>
    </message>
    <message>
        <source>Jan</source>
        <translation>1月</translation>
    </message>
    <message>
        <source>Feb</source>
        <translation>2月</translation>
    </message>
    <message>
        <source>Mar</source>
        <translation>3月</translation>
    </message>
    <message>
        <source>Apr</source>
        <translation>4月</translation>
    </message>
    <message>
        <source>May</source>
        <translation>5月</translation>
    </message>
    <message>
        <source>Jun</source>
        <translation>6月</translation>
    </message>
    <message>
        <source>Jul</source>
        <translation>7月</translation>
    </message>
    <message>
        <source>Aug</source>
        <translation>8月</translation>
    </message>
    <message>
        <source>Sep</source>
        <translation>9月</translation>
    </message>
    <message>
        <source>Oct</source>
        <translation>10月</translation>
    </message>
    <message>
        <source>Nov</source>
        <translation>11月</translation>
    </message>
    <message>
        <source>Dec</source>
        <translation>12月</translation>
    </message>
    <message>
        <source>Today</source>
        <translation>今日</translation>
    </message>
    <message>
        <source>Tomorrow</source>
        <translation>明日</translation>
    </message>
    <message>
        <source>Yesterday</source>
        <translation>昨日</translation>
    </message>
    <message>
        <source>%1 %2</source>
        <comment>a date and its year</comment>
        <translation>%2年%1</translation>
    </message>
    <message>
        <source>%1 %2 %3</source>
        <comment>weekday, day of the month, month: Sat 24 Oct</comment>
        <translation>%3%2日(%1)</translation>
    </message>
    <message>
        <source>(%1 does not exist that day)</source>
        <comment>a clock time skipped by a daylight saving change</comment>
        <translation>（この日は %1 が存在しません）</translation>
    </message>
    <message>
        <source>Not connected to a server; tasks stay on this computer.</source>
        <translation>サーバーに接続していません。タスクはこのコンピューターに保存されます。</translation>
    </message>
    <message>
        <source>No server connected.</source>
        <translation>サーバーが接続されていません。</translation>
    </message>
    <message>
        <source>Connecting…</source>
        <translation>接続中…</translation>
    </message>
    <message numerus="yes">
        <source>Sending %n change(s)…</source>
        <translation>
            <numerusform>%n 件の変更を送信中…</numerusform>
        </translation>
    </message>
    <message>
        <source>The server signed this computer out. Connect again with a new code; your tasks stay here.</source>
        <translation>サーバーがこのコンピューターをサインアウトしました。新しいコードで再接続してください。タスクはここに残ります。</translation>
    </message>
    <message numerus="yes">
        <source>Offline: %n change(s) wait for the server.</source>
        <translation>
            <numerusform>オフライン: %n 件の変更がサーバーへの送信を待っています。</numerusform>
        </translation>
    </message>
    <message>
        <source>Cannot reach the server.</source>
        <translation>サーバーに接続できません。</translation>
    </message>
    <message>
        <source>The server has a problem.</source>
        <translation>サーバーに問題があります。</translation>
    </message>
</context>
<context>
    <name>Main</name>
    <message>
        <source>Today</source>
        <translation>今日</translation>
    </message>
    <message>
        <source>Menu</source>
        <translation>メニュー</translation>
    </message>
    <message>
        <source>Disconnect</source>
        <translation>切断</translation>
    </message>
    <message>
        <source>Connect…</source>
        <translation>接続…</translation>
    </message>
    <message>
        <source>Settings…</source>
        <translation>設定…</translation>
    </message>
    <message>
        <source>Sync Now</source>
        <translation>今すぐ同期</translation>
    </message>
    <message>
        <source>Quit Dayhand</source>
        <translation>Dayhand を終了</translation>
    </message>
    <message>
        <source>Disconnect from the server?</source>
        <translation>サーバーから切断しますか？</translation>
    </message>
    <message>
        <source>Dayhand forgets the sign-in on this computer. Your tasks and waiting changes stay here. To end it on the server too, run: dayhand revoke %1</source>
        <translation>Dayhand はこのコンピューターのサインイン情報を削除します。タスクと未送信の変更はここに残ります。サーバー側でも終了するには次を実行してください: dayhand revoke %1</translation>
    </message>
</context>
<context>
    <name>QuickAddField</name>
    <message>
        <source>New task, e.g. Call the accountant fri 2pm</source>
        <translation>新しいタスク（例: 会計士に電話 fri 2pm）</translation>
    </message>
    <message>
        <source>Add a task (try: Pay rent fri 9am)</source>
        <translation>タスクを追加（例: 家賃を払う fri 9am）</translation>
    </message>
    <message>
        <source>Return adds it for today; a date at the end (tomorrow 9am, fri, 23 oct) sets the day.</source>
        <translation>Enter で今日のタスクとして追加。末尾の日付（tomorrow 9am, fri, 23 oct）で日を指定できます。</translation>
    </message>
    <message>
        <source>%1  ·  from “%2”</source>
        <translation>%1  ·  「%2」から</translation>
    </message>
    <message>
        <source>Keep in title</source>
        <translation>タイトルに残す</translation>
    </message>
</context>
<context>
    <name>ReminderPlanner</name>
    <message>
        <source>Today</source>
        <translation>今日</translation>
    </message>
    <message>
        <source>Tomorrow</source>
        <translation>明日</translation>
    </message>
    <message>
        <source>Now, %1</source>
        <comment>a reminder at the task&apos;s time</comment>
        <translation>今、%1</translation>
    </message>
    <message>
        <source>%1 at %2</source>
        <comment>a reminder before the task: Today at 09:00</comment>
        <translation>%1 %2</translation>
    </message>
    <message numerus="yes">
        <source>%n task(s) today</source>
        <comment>morning summary</comment>
        <translation>
            <numerusform>今日のタスク %n 件</numerusform>
        </translation>
    </message>
    <message numerus="yes">
        <source>%1, %n overdue</source>
        <comment>morning summary: 1 task today, 2 overdue</comment>
        <translation>
            <numerusform>%1、期限切れ %n 件</numerusform>
        </translation>
    </message>
    <message>
        <source>Nothing planned. Add a task with the quick add shortcut.</source>
        <translation>予定はありません。クイック追加のショートカットでタスクを追加しましょう。</translation>
    </message>
    <message>
        <source>Start with: %1</source>
        <comment>morning summary: the first task</comment>
        <translation>まずはこれから: %1</translation>
    </message>
</context>
<context>
    <name>SettingsDialog</name>
    <message>
        <source>Settings</source>
        <translation>設定</translation>
    </message>
    <message>
        <source>Language</source>
        <translation>言語</translation>
    </message>
    <message>
        <source>Quick add reads dates in English in every language, as dayhand does: tomorrow 9am, fri, 23 oct.</source>
        <translation>クイック追加は、dayhand と同じく、どの言語でも日付を英語で読み取ります: tomorrow 9am, fri, 23 oct。</translation>
    </message>
</context>
<context>
    <name>StatusLine</name>
    <message>
        <source>Connect…</source>
        <translation>接続…</translation>
    </message>
</context>
<context>
    <name>TaskRow</name>
    <message>
        <source>Mark as not done</source>
        <translation>未完了にする</translation>
    </message>
    <message>
        <source>Mark as done</source>
        <translation>完了にする</translation>
    </message>
    <message>
        <source>Where I stopped: %1</source>
        <translation>中断したところ: %1</translation>
    </message>
    <message>
        <source>Working on it now</source>
        <translation>今取り組んでいます</translation>
    </message>
    <message>
        <source>To today</source>
        <translation>今日へ</translation>
    </message>
    <message>
        <source>Not now</source>
        <translation>今はやめる</translation>
    </message>
    <message>
        <source>Task menu</source>
        <translation>タスクのメニュー</translation>
    </message>
    <message>
        <source>Mark as Not Done</source>
        <translation>未完了にする</translation>
    </message>
    <message>
        <source>Mark as Done</source>
        <translation>完了にする</translation>
    </message>
    <message>
        <source>Not Now</source>
        <translation>今はやめる</translation>
    </message>
    <message>
        <source>Work on It Now</source>
        <translation>今取り組む</translation>
    </message>
    <message>
        <source>To Today</source>
        <translation>今日へ</translation>
    </message>
    <message>
        <source>To Tomorrow</source>
        <translation>明日へ</translation>
    </message>
    <message>
        <source>Archive</source>
        <translation>アーカイブ</translation>
    </message>
    <message>
        <source>Move to Trash</source>
        <translation>ゴミ箱に移動</translation>
    </message>
</context>
<context>
    <name>TodayList</name>
    <message>
        <source>Nothing planned for today.</source>
        <translation>今日の予定はありません。</translation>
    </message>
    <message>
        <source>Add Task</source>
        <translation>タスクを追加</translation>
    </message>
    <message>
        <source>Overdue (%1)</source>
        <translation>期限切れ (%1)</translation>
    </message>
    <message>
        <source>Now</source>
        <translation>今</translation>
    </message>
    <message>
        <source>Today</source>
        <translation>今日</translation>
    </message>
    <message>
        <source>Nothing left for today.</source>
        <translation>今日の残りはありません。</translation>
    </message>
    <message>
        <source>Nothing else planned for today.</source>
        <translation>今日はほかに予定がありません。</translation>
    </message>
    <message>
        <source>Done (%1)</source>
        <translation>完了 (%1)</translation>
    </message>
</context>
<context>
    <name>dayhand::AppModel</name>
    <message>
        <source>The keyring could not be read (%1), so Dayhand starts without a server.</source>
        <translation>キーリングを読み取れなかったため（%1）、Dayhand はサーバーなしで起動します。</translation>
    </message>
    <message>
        <source>Reading tasks failed: %1</source>
        <translation>タスクを読み込めませんでした: %1</translation>
    </message>
    <message>
        <source>Today</source>
        <translation>今日</translation>
    </message>
    <message>
        <source>The change could not be saved: %1</source>
        <translation>変更を保存できませんでした: %1</translation>
    </message>
    <message>
        <source>The sign-in could not be removed from the keyring: %1</source>
        <translation>キーリングからサインイン情報を削除できませんでした: %1</translation>
    </message>
    <message>
        <source>System (%1)</source>
        <translation>システム (%1)</translation>
    </message>
</context>
<context>
    <name>dayhand::Notifier</name>
    <message>
        <source>Open</source>
        <translation>開く</translation>
    </message>
    <message>
        <source>Done</source>
        <translation>完了</translation>
    </message>
</context>
<context>
    <name>dayhand::Tray</name>
    <message numerus="yes">
        <source>%n open task(s) today</source>
        <translation>
            <numerusform>今日の未完了タスク %n 件</numerusform>
        </translation>
    </message>
    <message numerus="yes">
        <source>%1, %n overdue</source>
        <comment>1 open task today, 2 overdue</comment>
        <translation>
            <numerusform>%1、期限切れ %n 件</numerusform>
        </translation>
    </message>
    <message>
        <source>Dayhand: %1</source>
        <translation>Dayhand: %1</translation>
    </message>
    <message>
        <source>Quick Add…</source>
        <translation>クイック追加…</translation>
    </message>
    <message>
        <source>Open Dayhand</source>
        <translation>Dayhand を開く</translation>
    </message>
    <message numerus="yes">
        <source>%n more in Dayhand…</source>
        <translation>
            <numerusform>Dayhand にあと %n 件…</numerusform>
        </translation>
    </message>
    <message>
        <source>Sync Now</source>
        <translation>今すぐ同期</translation>
    </message>
    <message>
        <source>Quit Dayhand</source>
        <translation>Dayhand を終了</translation>
    </message>
</context>
</TS>
