module Main where

import Prelude
import Effect (Effect)
import Effect.Console (log)
import Utils (helperFunction, anotherUtil) -- Import from Utils

main :: Effect Unit
main = do
  log "Hello from PureScript!"
  log "This is a sample file for the purescript-mcp-server."
  helperFunction "called from Main"
  anotherUtil -- This will indirectly call log again via helperFunction
