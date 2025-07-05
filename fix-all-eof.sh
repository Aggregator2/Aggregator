#!/bin/bash

# Find all JS/TS files in pages/api and ensure they end with newline
find pages/api -name "*.js" -o -name "*.ts" | while read file; do
  if [ -f "$file" ]; then
    # Add newline if missing
    if [ -n "$(tail -c 1 "$file")" ]; then
      echo >> "$file"
      echo "Fixed: $file"
    fi
  fi
done

echo "All EOF errors fixed"