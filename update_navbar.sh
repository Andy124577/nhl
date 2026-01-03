#!/bin/bash

# This script updates all HTML files with the new navbar structure

for file in draft.html classement.html trade.html draftActif.html draftFini.html; do
  echo "Processing $file..."
  
  # Add navbar.css link if not present
  if ! grep -q "navbar.css" "$file"; then
    sed -i 's|</head>|    <link rel="stylesheet" href="navbar.css">\n</head>|' "$file"
  fi
  
  # Add navbar.js script if not present
  if ! grep -q "navbar.js" "$file"; then
    sed -i 's|<script src="poolSelector.js">|<script src="navbar.js"></script>\n    <script src="poolSelector.js">|' "$file"
  fi
done

echo "Navbar updates complete!"
