module Main exposing (main)

{-| JAKESJAM operator console — Elm SPA against /ops/api/* (cookie auth).
-}

import Browser
import Html exposing (Html, a, button, div, footer, form, h1, h2, header, input, label, main_, nav, p, pre, span, table, tbody, td, text, th, thead, tr)
import Html.Attributes as A
import Html.Events as E
import Http
import Json.Decode as D
import Json.Encode as Enc
import Time



-- MODEL


type alias Model =
    { phase : Phase
    , secretDraft : String
    , loginError : Maybe String
    , tab : Tab
    , status : Maybe Status
    , clips : List Clip
    , clipStats : Maybe ClipStats
    , busy : Bool
    , flash : Maybe String
    , pinDraft : Maybe { filename : String, note : String }
    , nowMs : Int
    }


type Phase
    = Booting
    | Login
    | Ready
    | Closed String


type Tab
    = Overview
    | Clips
    | Rooms
    | Raw


type alias Status =
    { ok : Bool
    , region : String
    , port_ : Int
    , uptimeSec : Int
    , startedAt : String
    , world : Maybe WorldSummary
    , matches : List MatchSummary
    , matchCount : Int
    , privateLobbies : List Lobby
    , clipsRecent : List RecentClip
    , clipsStats : ClipStats
    , env : EnvFlags
    }


type alias WorldSummary =
    { matchId : String
    , mapId : String
    , phase : String
    , roundIndex : Int
    , players : Int
    , joinable : Bool
    , chaosModifierIds : List String
    , snapshotsDropped : Int
    }


type alias MatchSummary =
    { matchId : String
    , mapId : String
    , phase : String
    , players : Int
    }


type alias Lobby =
    { code : String
    , status : String
    , mapId : String
    , playerCount : Int
    , hostPlayerId : String
    }


type alias ClipStats =
    { totalBytes : Int
    , maxBytes : Int
    , fileCount : Int
    , pinnedCount : Int
    , keptCount : Int
    }


type alias RecentClip =
    { filename : String
    , sizeBytes : Int
    , pinned : Bool
    , mtimeMs : Int
    , path : String
    }


type alias Clip =
    { filename : String
    , id : String
    , ext : String
    , sizeBytes : Int
    , mtimeMs : Int
    , pinned : Bool
    , kept : Bool
    , path : String
    , note : Maybe String
    }


type alias EnvFlags =
    { adminSecretConfigured : Bool
    , publicUrl : Maybe String
    , worldMap : Maybe String
    , worldBots : String
    , serveClientDir : Bool
    , wasmCollision : Bool
    , wasmPlayer : Bool
    , convexUrl : Bool
    , nodeEnv : String
    }


init : () -> ( Model, Cmd Msg )
init _ =
    ( { phase = Booting
      , secretDraft = ""
      , loginError = Nothing
      , tab = Overview
      , status = Nothing
      , clips = []
      , clipStats = Nothing
      , busy = False
      , flash = Nothing
      , pinDraft = Nothing
      , nowMs = 0
      }
    , Cmd.batch [ fetchStatus, fetchClips ]
    )



-- UPDATE


type Msg
    = GotStatus (Result Http.Error Status)
    | GotClips (Result Http.Error ( List Clip, ClipStats ))
    | TypedSecret String
    | SubmitLogin
    | LoginResult (Result Http.Error ())
    | Logout
    | LogoutDone (Result Http.Error ())
    | SetTab Tab
    | Refresh
    | Tick Time.Posix
    | AskPin String
    | TypedPinNote String
    | ConfirmPin
    | CancelPin
    | PinDone (Result Http.Error ())
    | AskUnpin String
    | UnpinDone (Result Http.Error ())
    | ClearFlash


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotStatus (Ok status) ->
            ( { model
                | phase = Ready
                , status = Just status
                , clipStats = Just status.clipsStats
                , loginError = Nothing
                , busy = False
              }
            , Cmd.none
            )

        GotStatus (Err err) ->
            case err of
                Http.BadStatus 503 ->
                    ( { model | phase = Closed "ADMIN_SECRET not set on this process.", busy = False }
                    , Cmd.none
                    )

                Http.BadStatus 401 ->
                    ( { model | phase = Login, status = Nothing, busy = False }
                    , Cmd.none
                    )

                _ ->
                    if model.phase == Ready then
                        ( { model | flash = Just (httpErr err), busy = False }, Cmd.none )

                    else
                        ( { model | phase = Login, loginError = Just (httpErr err), busy = False }
                        , Cmd.none
                        )

        GotClips (Ok ( clips, stats )) ->
            ( { model | clips = clips, clipStats = Just stats }, Cmd.none )

        GotClips (Err _) ->
            ( model, Cmd.none )

        TypedSecret s ->
            ( { model | secretDraft = s }, Cmd.none )

        SubmitLogin ->
            if String.isEmpty (String.trim model.secretDraft) then
                ( { model | loginError = Just "Enter ADMIN_SECRET." }, Cmd.none )

            else
                ( { model | busy = True, loginError = Nothing }
                , postLogin model.secretDraft
                )

        LoginResult (Ok ()) ->
            ( { model | secretDraft = "", busy = True, phase = Booting }
            , Cmd.batch [ fetchStatus, fetchClips ]
            )

        LoginResult (Err err) ->
            ( { model
                | busy = False
                , loginError =
                    Just
                        (case err of
                            Http.BadStatus 401 ->
                                "Wrong secret."

                            Http.BadStatus 503 ->
                                "Ops closed: set ADMIN_SECRET on the server."

                            _ ->
                                httpErr err
                        )
              }
            , Cmd.none
            )

        Logout ->
            ( { model | busy = True }, postLogout )

        LogoutDone _ ->
            ( { model
                | phase = Login
                , status = Nothing
                , clips = []
                , busy = False
                , secretDraft = ""
              }
            , Cmd.none
            )

        SetTab t ->
            ( { model | tab = t }, Cmd.none )

        Refresh ->
            ( { model | busy = True, flash = Nothing }
            , Cmd.batch [ fetchStatus, fetchClips ]
            )

        Tick posix ->
            let
                ms =
                    Time.posixToMillis posix
            in
            ( { model | nowMs = ms }
            , if model.phase == Ready then
                Cmd.batch [ fetchStatus, fetchClips ]

              else
                Cmd.none
            )

        AskPin filename ->
            ( { model | pinDraft = Just { filename = filename, note = "Pinned from ops" } }
            , Cmd.none
            )

        TypedPinNote note ->
            case model.pinDraft of
                Just d ->
                    ( { model | pinDraft = Just { d | note = note } }, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )

        ConfirmPin ->
            case model.pinDraft of
                Just d ->
                    ( { model | pinDraft = Nothing, busy = True }
                    , postPin d.filename d.note
                    )

                Nothing ->
                    ( model, Cmd.none )

        CancelPin ->
            ( { model | pinDraft = Nothing }, Cmd.none )

        PinDone (Ok ()) ->
            ( { model | busy = False, flash = Just "Pinned." }
            , Cmd.batch [ fetchStatus, fetchClips ]
            )

        PinDone (Err err) ->
            ( { model | busy = False, flash = Just (httpErr err) }, Cmd.none )

        AskUnpin filename ->
            ( { model | busy = True }, postUnpin filename )

        UnpinDone (Ok ()) ->
            ( { model | busy = False, flash = Just "Unpinned." }
            , Cmd.batch [ fetchStatus, fetchClips ]
            )

        UnpinDone (Err err) ->
            ( { model | busy = False, flash = Just (httpErr err) }, Cmd.none )

        ClearFlash ->
            ( { model | flash = Nothing }, Cmd.none )



-- HTTP


fetchStatus : Cmd Msg
fetchStatus =
    Http.get
        { url = "/ops/api/status"
        , expect = Http.expectJson GotStatus statusDecoder
        }


fetchClips : Cmd Msg
fetchClips =
    Http.get
        { url = "/ops/api/clips"
        , expect = Http.expectJson GotClips clipsPayloadDecoder
        }


postLogin : String -> Cmd Msg
postLogin secret =
    Http.post
        { url = "/ops/login"
        , body =
            Http.jsonBody
                (Enc.object [ ( "secret", Enc.string secret ) ])
        , expect = Http.expectWhatever LoginResult
        }


postLogout : Cmd Msg
postLogout =
    Http.post
        { url = "/ops/logout"
        , body = Http.emptyBody
        , expect = Http.expectWhatever LogoutDone
        }


postPin : String -> String -> Cmd Msg
postPin filename note =
    Http.post
        { url = "/ops/api/clips/pin"
        , body =
            Http.jsonBody
                (Enc.object
                    [ ( "filename", Enc.string filename )
                    , ( "note", Enc.string note )
                    ]
                )
        , expect = Http.expectWhatever PinDone
        }


postUnpin : String -> Cmd Msg
postUnpin filename =
    Http.post
        { url = "/ops/api/clips/unpin"
        , body =
            Http.jsonBody
                (Enc.object [ ( "filename", Enc.string filename ) ])
        , expect = Http.expectWhatever UnpinDone
        }


httpErr : Http.Error -> String
httpErr err =
    case err of
        Http.BadUrl u ->
            "Bad URL: " ++ u

        Http.Timeout ->
            "Timeout"

        Http.NetworkError ->
            "Network error"

        Http.BadStatus n ->
            "HTTP " ++ String.fromInt n

        Http.BadBody b ->
            "Decode: " ++ b



-- DECODERS


statusDecoder : D.Decoder Status
statusDecoder =
    D.map8
        (\ok region port_ uptime started world matches matchCount ->
            { ok = ok
            , region = region
            , port_ = port_
            , uptimeSec = uptime
            , startedAt = started
            , world = world
            , matches = matches
            , matchCount = matchCount
            , privateLobbies = []
            , clipsRecent = []
            , clipsStats =
                { totalBytes = 0
                , maxBytes = 1
                , fileCount = 0
                , pinnedCount = 0
                , keptCount = 0
                }
            , env =
                { adminSecretConfigured = False
                , publicUrl = Nothing
                , worldMap = Nothing
                , worldBots = "0"
                , serveClientDir = False
                , wasmCollision = False
                , wasmPlayer = False
                , convexUrl = False
                , nodeEnv = "?"
                }
            }
        )
        (D.field "ok" D.bool)
        (D.field "region" D.string)
        (D.field "port" D.int)
        (D.field "uptimeSec" D.int)
        (D.field "startedAt" D.string)
        (D.field "world" (D.nullable worldDecoder))
        (D.field "matches" (D.list matchDecoder))
        (D.field "matchCount" D.int)
        |> D.andThen
            (\base ->
                D.map3
                    (\lobbies clipsBlock env ->
                        { base
                            | privateLobbies = lobbies
                            , clipsRecent = clipsBlock.recent
                            , clipsStats = clipsBlock.stats
                            , env = env
                        }
                    )
                    (D.field "privateLobbies" (D.list lobbyDecoder))
                    (D.field "clips" clipsBlockDecoder)
                    (D.field "env" envDecoder)
            )


clipsBlockDecoder : D.Decoder { stats : ClipStats, recent : List RecentClip }
clipsBlockDecoder =
    D.map2 (\stats recent -> { stats = stats, recent = recent })
        (D.field "stats" clipStatsDecoder)
        (D.field "recent" (D.list recentClipDecoder))


worldDecoder : D.Decoder WorldSummary
worldDecoder =
    D.map8 WorldSummary
        (D.field "matchId" D.string)
        (D.field "mapId" D.string)
        (D.field "phase" D.string)
        (D.field "roundIndex" D.int)
        (D.field "players" D.int)
        (D.field "joinable" D.bool)
        (D.field "chaosModifierIds" (D.list D.string))
        (D.field "snapshotsDroppedForBackpressure" D.int)


matchDecoder : D.Decoder MatchSummary
matchDecoder =
    D.map4 MatchSummary
        (D.field "matchId" D.string)
        (D.field "mapId" D.string)
        (D.field "phase" D.string)
        (D.field "players" D.int)


lobbyDecoder : D.Decoder Lobby
lobbyDecoder =
    D.map5 Lobby
        (D.field "code" D.string)
        (D.field "status" D.string)
        (D.field "mapId" D.string)
        (D.field "playerCount" D.int)
        (D.field "hostPlayerId" D.string)


clipStatsDecoder : D.Decoder ClipStats
clipStatsDecoder =
    D.map5 ClipStats
        (D.field "totalBytes" D.int)
        (D.field "maxBytes" D.int)
        (D.field "fileCount" D.int)
        (D.field "pinnedCount" D.int)
        (D.field "keptCount" D.int)


recentClipDecoder : D.Decoder RecentClip
recentClipDecoder =
    D.map5 RecentClip
        (D.field "filename" D.string)
        (D.field "sizeBytes" D.int)
        (D.field "pinned" D.bool)
        (D.field "mtimeMs" D.float |> D.map round)
        (D.field "path" D.string)


clipDecoder : D.Decoder Clip
clipDecoder =
    D.succeed Clip
        |> D.map2 (|>) (D.field "filename" D.string)
        |> D.map2 (|>) (D.field "id" D.string)
        |> D.map2 (|>) (D.field "ext" D.string)
        |> D.map2 (|>) (D.field "sizeBytes" D.int)
        |> D.map2 (|>) (D.field "mtimeMs" D.float |> D.map round)
        |> D.map2 (|>) (D.field "pinned" D.bool)
        |> D.map2 (|>) (D.field "kept" D.bool)
        |> D.map2 (|>) (D.field "path" D.string)
        |> D.map2 (|>) (D.maybe (D.field "note" D.string))


clipsPayloadDecoder : D.Decoder ( List Clip, ClipStats )
clipsPayloadDecoder =
    D.map2 Tuple.pair
        (D.field "clips" (D.list clipDecoder))
        (D.field "stats" clipStatsDecoder)


envDecoder : D.Decoder EnvFlags
envDecoder =
    D.map8
        (\a p w bots serve wc wp convex ->
            { adminSecretConfigured = a
            , publicUrl = p
            , worldMap = w
            , worldBots = bots
            , serveClientDir = serve
            , wasmCollision = wc
            , wasmPlayer = wp
            , convexUrl = convex
            , nodeEnv = "?"
            }
        )
        (D.field "adminSecretConfigured" D.bool)
        (D.field "publicUrl" (D.nullable D.string))
        (D.field "worldMap" (D.nullable D.string))
        (D.field "worldBots" D.string)
        (D.field "serveClientDir" D.bool)
        (D.field "wasmCollision" D.bool)
        (D.field "wasmPlayer" D.bool)
        (D.field "convexUrl" D.bool)
        |> D.andThen
            (\base ->
                D.map
                    (\nodeEnv -> { base | nodeEnv = nodeEnv })
                    (D.field "nodeEnv" D.string)
            )



-- VIEW


view : Model -> Html Msg
view model =
    case model.phase of
        Booting ->
            div [ A.class "boot" ] [ text "Loading ops…" ]

        Closed reason ->
            main_ [ A.class "login" ]
                [ div [ A.class "card" ]
                    [ h1 [] [ text "OPS" ]
                    , p [ A.class "err" ] [ text reason ]
                    , p [ A.class "hint" ] [ text "export ADMIN_SECRET=… and restart the game server." ]
                    ]
                ]

        Login ->
            viewLogin model

        Ready ->
            viewDashboard model


viewLogin : Model -> Html Msg
viewLogin model =
    main_ [ A.class "login" ]
        [ div [ A.class "card" ]
            [ h1 [] [ text "OPS" ]
            , p [ A.class "muted" ] [ text "Operator console · play.elyad.io" ]
            , case model.loginError of
                Just e ->
                    p [ A.class "err" ] [ text e ]

                Nothing ->
                    text ""
            , form [ E.onSubmit SubmitLogin ]
                [ label [ A.for "secret" ] [ text "ADMIN_SECRET" ]
                , input
                    [ A.id "secret"
                    , A.type_ "password"
                    , A.attribute "autocomplete" "current-password"
                    , A.value model.secretDraft
                    , A.autofocus True
                    , A.disabled model.busy
                    , E.onInput TypedSecret
                    ]
                    []
                , button
                    [ A.type_ "submit"
                    , A.disabled model.busy
                    ]
                    [ text
                        (if model.busy then
                            "…"

                         else
                            "Enter"
                        )
                    ]
                ]
            , p [ A.class "hint" ]
                [ text "Or open "
                , span [ A.class "code" ] [ text "/ops?key=…" ]
                , text " once to set the cookie."
                ]
            ]
        ]


viewDashboard : Model -> Html Msg
viewDashboard model =
    let
        st =
            model.status
    in
    div [ A.class "shell" ]
        [ header [ A.class "top" ]
            [ div [ A.class "brand" ]
                [ span [ A.class "pulse" ] []
                , span [ A.class "brand-title" ] [ text "JAKESJAM OPS" ]
                , span [ A.class "muted" ]
                    [ text
                        (case st of
                            Just s ->
                                s.region ++ " · :" ++ String.fromInt s.port_

                            Nothing ->
                                "—"
                        )
                    ]
                ]
            , div [ A.class "actions" ]
                [ button [ A.type_ "button", A.class "ghost", E.onClick Refresh, A.disabled model.busy ]
                    [ text "Refresh" ]
                , button [ A.type_ "button", A.class "ghost", E.onClick Logout ]
                    [ text "Logout" ]
                ]
            ]
        , viewStats model
        , case model.flash of
            Just f ->
                div [ A.class "flash", E.onClick ClearFlash ] [ text f ]

            Nothing ->
                text ""
        , nav [ A.class "tabs" ]
            [ tabBtn model Overview "Overview"
            , tabBtn model Clips "Clips"
            , tabBtn model Rooms "Rooms"
            , tabBtn model Raw "Raw JSON"
            ]
        , case model.tab of
            Overview ->
                viewOverview model

            Clips ->
                viewClips model

            Rooms ->
                viewRooms model

            Raw ->
                viewRaw model
        , viewPinModal model
        , footer [ A.class "foot muted" ]
            [ text "Elm console · cookie auth · API "
            , span [ A.class "code" ] [ text "/ops/api/*" ]
            ]
        ]


tabBtn : Model -> Tab -> String -> Html Msg
tabBtn model t label =
    button
        [ A.type_ "button"
        , A.classList [ ( "tab", True ), ( "on", model.tab == t ) ]
        , E.onClick (SetTab t)
        ]
        [ text label ]


viewStats : Model -> Html Msg
viewStats model =
    let
        st =
            model.status

        worldLine =
            case Maybe.andThen .world st of
                Just w ->
                    String.fromInt w.players ++ "p · " ++ w.phase ++ " · " ++ w.mapId

                Nothing ->
                    "idle"

        uptime =
            Maybe.map (.uptimeSec >> fmtUptime) st |> Maybe.withDefault "—"

        matches =
            Maybe.map (.matchCount >> String.fromInt) st |> Maybe.withDefault "—"

        private =
            Maybe.map (.privateLobbies >> List.length >> String.fromInt) st |> Maybe.withDefault "—"

        files =
            model.clipStats
                |> Maybe.map (.fileCount >> String.fromInt)
                |> Maybe.withDefault "—"

        pinned =
            model.clipStats
                |> Maybe.map (.pinnedCount >> String.fromInt)
                |> Maybe.withDefault "—"
    in
    div [ A.class "grid stats" ]
        [ tile "Uptime" uptime
        , tile "World" worldLine
        , tile "Matches" matches
        , tile "Private" private
        , tile "Clips" files
        , tile "Pinned" pinned
        ]


tile : String -> String -> Html Msg
tile k v =
    div [ A.class "tile" ]
        [ div [ A.class "k" ] [ text k ]
        , div [ A.class "v" ] [ text v ]
        ]


viewOverview : Model -> Html Msg
viewOverview model =
    div [ A.class "panel on" ]
        [ div [ A.class "cols" ]
            [ div [ A.class "card" ]
                [ h2 [] [ text "World" ]
                , pre [ A.class "mono" ]
                    [ text
                        (case Maybe.andThen .world model.status of
                            Just w ->
                                prettyWorld w

                            Nothing ->
                                "null"
                        )
                    ]
                ]
            , div [ A.class "card" ]
                [ h2 [] [ text "Environment" ]
                , pre [ A.class "mono" ]
                    [ text
                        (case Maybe.map .env model.status of
                            Just e ->
                                prettyEnv e

                            Nothing ->
                                "—"
                        )
                    ]
                ]
            ]
        , div [ A.class "card" ]
            [ h2 [] [ text "Recent clips" ]
            , div [ A.class "clip-list" ]
                (case Maybe.map .clipsRecent model.status of
                    Just [] ->
                        [ p [ A.class "muted" ] [ text "No clips yet" ] ]

                    Just xs ->
                        List.map (viewRecent model.nowMs) xs

                    Nothing ->
                        [ text "—" ]
                )
            ]
        ]


viewRecent : Int -> RecentClip -> Html Msg
viewRecent now c =
    div [ A.class "clip-row" ]
        [ a [ A.href c.path, A.target "_blank", A.rel "noopener" ]
            [ text (shortName c.filename) ]
        , span []
            [ text (fmtBytes c.sizeBytes)
            , if c.pinned then
                span [ A.class "tag pin" ] [ text " PIN" ]

              else
                text ""
            ]
        ]


viewClips : Model -> Html Msg
viewClips model =
    let
        statsLine =
            case model.clipStats of
                Just s ->
                    String.fromInt s.fileCount
                        ++ " files · "
                        ++ fmtBytes s.totalBytes
                        ++ " / "
                        ++ fmtBytes s.maxBytes
                        ++ " · "
                        ++ String.fromInt s.pinnedCount
                        ++ " pinned"

                Nothing ->
                    "—"

        pct =
            case model.clipStats of
                Just s ->
                    if s.maxBytes <= 0 then
                        0

                    else
                        min 100 (toFloat s.totalBytes / toFloat s.maxBytes * 100)

                Nothing ->
                    0
    in
    div [ A.class "panel on" ]
        [ div [ A.class "card" ]
            [ div [ A.class "row-between" ]
                [ h2 [] [ text "Clip inventory" ]
                , div [ A.class "muted" ] [ text statsLine ]
                ]
            , div [ A.class "bar" ]
                [ div
                    [ A.class "bar-fill"
                    , A.style "width" (String.fromFloat pct ++ "%")
                    ]
                    []
                ]
            , div [ A.class "table-wrap" ]
                [ table [ A.class "data" ]
                    [ thead []
                        [ tr []
                            [ th [] [ text "File" ]
                            , th [] [ text "Size" ]
                            , th [] [ text "Age" ]
                            , th [] [ text "Flags" ]
                            , th [] [ text "" ]
                            ]
                        ]
                    , tbody []
                        (if List.isEmpty model.clips then
                            [ tr []
                                [ td [ A.colspan 5, A.class "muted" ] [ text "No clips on disk" ] ]
                            ]

                         else
                            List.map (clipRow model.nowMs) model.clips
                        )
                    ]
                ]
            ]
        ]


clipRow : Int -> Clip -> Html Msg
clipRow now c =
    tr []
        [ td []
            [ a [ A.href c.path, A.target "_blank", A.rel "noopener" ]
                [ text (shortName c.filename) ]
            ]
        , td [] [ text (fmtBytes c.sizeBytes) ]
        , td [] [ text (fmtAge now c.mtimeMs) ]
        , td []
            [ if c.pinned then
                span [ A.class "tag pin" ] [ text "PIN" ]

              else
                text ""
            , if c.kept then
                span [ A.class "tag kept" ] [ text "KEPT" ]

              else
                text ""
            ]
        , td []
            [ if c.pinned then
                button
                    [ A.type_ "button"
                    , A.class "btn-sm danger"
                    , E.onClick (AskUnpin c.filename)
                    ]
                    [ text "Unpin" ]

              else
                button
                    [ A.type_ "button"
                    , A.class "btn-sm ok"
                    , E.onClick (AskPin c.filename)
                    ]
                    [ text "Pin" ]
            ]
        ]


viewRooms : Model -> Html Msg
viewRooms model =
    div [ A.class "panel on" ]
        [ div [ A.class "cols" ]
            [ div [ A.class "card" ]
                [ h2 [] [ text "Private lobbies" ]
                , pre [ A.class "mono" ]
                    [ text
                        (case model.status of
                            Just s ->
                                if List.isEmpty s.privateLobbies then
                                    "[]"

                                else
                                    String.join "\n\n" (List.map prettyLobby s.privateLobbies)

                            Nothing ->
                                "—"
                        )
                    ]
                ]
            , div [ A.class "card" ]
                [ h2 [] [ text "Active matches" ]
                , pre [ A.class "mono" ]
                    [ text
                        (case model.status of
                            Just s ->
                                if List.isEmpty s.matches then
                                    "[]"

                                else
                                    String.join "\n\n" (List.map prettyMatch s.matches)

                            Nothing ->
                                "—"
                        )
                    ]
                ]
            ]
        ]


viewRaw : Model -> Html Msg
viewRaw model =
    div [ A.class "panel on" ]
        [ div [ A.class "card" ]
            [ h2 [] [ text "Status snapshot" ]
            , pre [ A.class "mono tall" ]
                [ text
                    (case model.status of
                        Just s ->
                            prettyStatus s

                        Nothing ->
                            "—"
                    )
                ]
            ]
        ]


viewPinModal : Model -> Html Msg
viewPinModal model =
    case model.pinDraft of
        Nothing ->
            text ""

        Just d ->
            div [ A.class "modal-backdrop" ]
                [ div [ A.class "modal card" ]
                    [ h2 [] [ text "Pin clip" ]
                    , p [ A.class "muted" ] [ text d.filename ]
                    , label [ A.for "pin-note" ] [ text "Note" ]
                    , input
                        [ A.id "pin-note"
                        , A.type_ "text"
                        , A.value d.note
                        , E.onInput TypedPinNote
                        , A.autofocus True
                        ]
                        []
                    , div [ A.class "modal-actions" ]
                        [ button [ A.type_ "button", A.class "ghost", E.onClick CancelPin ] [ text "Cancel" ]
                        , button [ A.type_ "button", E.onClick ConfirmPin ] [ text "Pin forever" ]
                        ]
                    ]
                ]



-- FORMATTERS


shortName : String -> String
shortName name =
    case String.split "." name of
        id :: ext :: _ ->
            String.left 8 id ++ "…" ++ ext

        _ ->
            name


fmtBytes : Int -> String
fmtBytes n =
    if n < 1024 then
        String.fromInt n ++ " B"

    else if n < 1024 * 1024 then
        String.fromFloat (toFloat (n // 102) / 10) ++ " KB"

    else
        String.fromFloat (toFloat (n // (1024 * 102)) / 10) ++ " MB"


fmtAge : Int -> Int -> String
fmtAge nowMs mtimeMs =
    let
        s =
            max 0 ((nowMs - mtimeMs) // 1000)
    in
    if nowMs == 0 then
        "—"

    else if s < 60 then
        String.fromInt s ++ "s"

    else if s < 3600 then
        String.fromInt (s // 60) ++ "m"

    else if s < 86400 then
        String.fromInt (s // 3600) ++ "h"

    else
        String.fromInt (s // 86400) ++ "d"


fmtUptime : Int -> String
fmtUptime sec =
    let
        d =
            sec // 86400

        h =
            modBy 24 (sec // 3600)

        m =
            modBy 60 (sec // 60)
    in
    if d > 0 then
        String.fromInt d ++ "d " ++ String.fromInt h ++ "h"

    else if h > 0 then
        String.fromInt h ++ "h " ++ String.fromInt m ++ "m"

    else
        String.fromInt m ++ "m " ++ String.fromInt (modBy 60 sec) ++ "s"


prettyWorld : WorldSummary -> String
prettyWorld w =
    String.join "\n"
        [ "matchId: " ++ w.matchId
        , "mapId: " ++ w.mapId
        , "phase: " ++ w.phase
        , "round: " ++ String.fromInt w.roundIndex
        , "players: " ++ String.fromInt w.players
        , "joinable: " ++ boolStr w.joinable
        , "chaos: " ++ String.join ", " w.chaosModifierIds
        , "droppedSnaps: " ++ String.fromInt w.snapshotsDropped
        ]


prettyEnv : EnvFlags -> String
prettyEnv e =
    String.join "\n"
        [ "adminSecret: " ++ boolStr e.adminSecretConfigured
        , "publicUrl: " ++ Maybe.withDefault "null" e.publicUrl
        , "worldMap: " ++ Maybe.withDefault "(rotate)" e.worldMap
        , "worldBots: " ++ e.worldBots
        , "serveClient: " ++ boolStr e.serveClientDir
        , "wasmCollision: " ++ boolStr e.wasmCollision
        , "wasmPlayer: " ++ boolStr e.wasmPlayer
        , "convex: " ++ boolStr e.convexUrl
        , "nodeEnv: " ++ e.nodeEnv
        ]


prettyLobby : Lobby -> String
prettyLobby l =
    l.code ++ " · " ++ l.status ++ " · " ++ l.mapId ++ " · " ++ String.fromInt l.playerCount ++ "p · host " ++ l.hostPlayerId


prettyMatch : MatchSummary -> String
prettyMatch m =
    m.matchId ++ " · " ++ m.mapId ++ " · " ++ m.phase ++ " · " ++ String.fromInt m.players ++ "p"


prettyStatus : Status -> String
prettyStatus s =
    String.join "\n"
        [ "ok: " ++ boolStr s.ok
        , "region: " ++ s.region
        , "port: " ++ String.fromInt s.port_
        , "uptimeSec: " ++ String.fromInt s.uptimeSec
        , "startedAt: " ++ s.startedAt
        , "matchCount: " ++ String.fromInt s.matchCount
        , "privateLobbies: " ++ String.fromInt (List.length s.privateLobbies)
        , "clips: " ++ String.fromInt s.clipsStats.fileCount ++ " files, " ++ String.fromInt s.clipsStats.pinnedCount ++ " pinned"
        , ""
        , "--- world ---"
        , case s.world of
            Just w ->
                prettyWorld w

            Nothing ->
                "null"
        , ""
        , "--- env ---"
        , prettyEnv s.env
        ]


boolStr : Bool -> String
boolStr b =
    if b then
        "true"

    else
        "false"



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions model =
    case model.phase of
        Ready ->
            Time.every 8000 Tick

        _ ->
            Sub.none



-- MAIN


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = subscriptions
        }
