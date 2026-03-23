<?php

require_once "{$_SERVER['DOCUMENT_ROOT']}/elog.php";

// elog($_GET);
// elog($_SERVER);


$page = $_GET['page'] ?? false;
if ($page == 'create') {
	require_once("create-game.html");
	exit;
}


$gameId = $_GET['game'] ?? false;
if ($gameId) {
	require_once("game.html");
	exit;
}

require_once("contents.html");