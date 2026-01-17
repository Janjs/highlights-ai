#!/bin/bash

if [ "$1" = "CACHE=1" ] || [ "$1" = "CACHE=true" ]; then
  export NEXT_PUBLIC_CACHE=1
fi

exec next dev -H localhost "$@"
