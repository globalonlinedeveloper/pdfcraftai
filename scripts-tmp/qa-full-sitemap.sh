#!/usr/bin/env bash
# QA phase 3: pull the full sitemap and check every URL.
set +e
BASE="https://pdfcraftai.com"
RESULTS=/tmp/qa-results-p3.txt
FAIL=/tmp/qa-failures-p3.txt
> "$RESULTS"
> "$FAIL"

URLS=$(curl -s "$BASE/sitemap.xml" | grep -oE "<loc>[^<]+</loc>" | sed 's|<loc>||;s|</loc>||')
TOTAL=$(echo "$URLS" | wc -l)
echo "Sweeping $TOTAL URLs from sitemap..."

i=0
echo "$URLS" | while read url; do
  i=$((i+1))
  result=$(curl -sL -o /dev/null -w "%{http_code} %{size_download}" "$url" 2>/dev/null)
  code=$(echo "$result" | awk '{print $1}')
  size=$(echo "$result" | awk '{print $2}')
  echo "$code $size $url" >> "$RESULTS"
  if [ "$code" != "200" ]; then
    echo "FAIL $code ${size}B $url" >> "$FAIL"
  elif [ "$size" -lt 5000 ]; then
    echo "THIN $code ${size}B $url" >> "$FAIL"
  fi
  if [ $((i % 30)) -eq 0 ]; then echo "  ... $i/$TOTAL"; fi
done

echo "Total: $(wc -l < "$RESULTS")"
echo "Failures + thin pages:"
cat "$FAIL"
