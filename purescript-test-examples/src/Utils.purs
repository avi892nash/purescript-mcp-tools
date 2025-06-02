module Utils where

import Prelude
import Effect (Effect)
import Effect.Console (log)
-- Intentionally import something from Main if Main were to export a utility
-- For now, let's assume Main might export a helper or constant in a real scenario
-- import Main (appVersion) -- Example, will be commented out if Main.appVersion doesn't exist

helperFunction :: String -> Effect Unit
helperFunction msg = do
  log $ "Helper says: " <> msg
  -- log $ "App version: " <> Main.appVersion -- if Main.appVersion was available

anotherHelper :: Int -> String
anotherHelper x = "Number: " <> show x

-- This function will call a (hypothetical) function from Main
-- For testing, let's make Main.main call this, and this call a (new) function in Main
-- to create a small cycle or at least a deeper call chain.
-- For now, let's keep it simple: Utils.anotherUtil calls helperFunction.
anotherUtil :: Effect Unit
anotherUtil = helperFunction "called from anotherUtil"
