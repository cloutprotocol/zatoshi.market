#!/bin/bash

# Load environment variables from .env.local
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
else
  echo "⚠️  Warning: .env.local not found. Using environment variables."
fi

# Run the script passed as argument
npx tsx "$@"
