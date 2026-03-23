<?php
require_once "{$_SERVER['DOCUMENT_ROOT']}/elog.php";


elog($_SERVER);
// exit("JF39944");
$action = $_GET['action'] ?? 'create';

$target = "https://hapi2.hbar.live/live/katomia/$action";

$ch = curl_init($target);

$headers = [];
foreach(getallheaders() as $name => $value){
  if(strtolower($name) !== "host"){
    $headers[] = "$name: $value";
  }
}

curl_setopt_array($ch, [
  CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
  CURLOPT_HTTPHEADER => $headers,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POSTFIELDS => file_get_contents("php://input")
]);

$response = curl_exec($ch);

$httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

curl_close($ch);

if($contentType)
  header("Content-Type: $contentType");

http_response_code($httpcode);

echo $response;

