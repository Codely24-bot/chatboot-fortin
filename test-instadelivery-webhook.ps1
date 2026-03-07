param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$PayloadPath = ".\\instadelivery-webhook-sample.json",
  [string]$Token = ""
)

$headers = @{
  "Content-Type" = "application/json"
}

if ($Token) {
  $headers["x-webhook-token"] = $Token
}

$body = Get-Content -Path $PayloadPath -Raw
$uri = "$BaseUrl/webhooks/instadelivery"

Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
