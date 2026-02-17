#!/bin/bash

export NEXT_PUBLIC_CACHE=0
exec next dev -H localhost "$@"
