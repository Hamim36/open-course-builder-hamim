$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
function J($m,$u,$b) {
  $params = @{ UseBasicParsing = $true; Uri = "$base$u"; Method = $m; ContentType = 'application/json' }
  if ($null -ne $b) { $params.Body = $b }
  try {
    $r = Invoke-WebRequest @params
    "{0,-6} {1,-40} -> {2}" -f $m, $u, $r.StatusCode
    if ($r.Content) {
      try {
        $o = $r.Content | ConvertFrom-Json
        # Summarize a few common fields
        $summary = @()
        if ($o.PSObject.Properties.Name -contains 'success') { $summary += "success=$($o.success)" }
        if ($o.PSObject.Properties.Name -contains 'topic') { $summary += "topic.is_completed=$($o.topic.is_completed)" }
        if ($o.PSObject.Properties.Name -contains 'is_active') { $summary += "is_active=$($o.is_active)" }
        if ($o.PSObject.Properties.Name -contains 'course') {
          $cn = if ($o.course) { $o.course.name } else { '<null>' }
          $summary += "course.name=$cn"
        }
        if ($o.PSObject.Properties.Name -contains 'stats_progress') { $summary += "stats_progress.completed=$($o.stats_progress.completed)" }
        if ($summary.Count -gt 0) { '   ' + ($summary -join '  ') }
      } catch {}
    }
  } catch {
    "{0,-6} {1,-40} -> ERR {2}" -f $m, $u, $_.Exception.Message
  }
}
$tid1 = 'e8cc17f3-b5eb-40f9-be07-c59bd780bcc7'
$tid2 = 'c79dab99-8a7a-4ecc-8e30-1fba366669b5'

Write-Host '--- visit idempotent ---'
J POST "/api/topics/$tid1/visit" '{}'

Write-Host '--- modify-save (PUT /api/courses) ---'
$gc = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/courses" -Method GET
$course = ($gc.Content | ConvertFrom-Json).course
if ($course) {
  ($course.modules | Where-Object id -eq '5a73d8d2-8e45-41fa-af0f-9d5d93422bba').name = 'Module A (renamed)'
  J PUT '/api/courses' ($course | ConvertTo-Json -Depth 10)
}

Write-Host '--- temp-course PUT ---'
J PUT '/api/temp-course' '{"course":{"name":"WIP","description":"x","modules":[]}}'

Write-Host '--- temp-course DELETE ---'
J DELETE '/api/temp-course' $null

Write-Host '--- temp-course GET after delete ---'
J GET '/api/temp-course' $null

Write-Host '--- git config PUT (fake remote) ---'
J PUT '/api/git/config' '{"remote_url":"https://example.com/fake.git","user_name":"smoke","user_email":"s@s.s"}'

Write-Host '--- git sync POST (will fail at push) ---'
J POST '/api/git/sync' '{}'
