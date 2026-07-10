module Main exposing (main)

{-| Elyad — parking page as a taster of things that may never come.
    Sci-fi gnostic reserved address. Soft promise only.
-}

import Browser
import Html exposing (Html, a, div, footer, h1, main_, p, span, text)
import Html.Attributes as A
import Html.Events as E
import Json.Decode as D
import List



-- MODEL


type alias Model =
    { reducedMotion : Bool
    , ctaPressed : Bool
    , ctaHot : Bool
    }


type alias Flags =
    { reducedMotion : Bool
    }


init : Flags -> ( Model, Cmd Msg )
init flags =
    ( { reducedMotion = flags.reducedMotion
      , ctaPressed = False
      , ctaHot = False
      }
    , Cmd.none
    )



-- UPDATE


type Msg
    = CtaDown
    | CtaUp
    | CtaEnter
    | CtaLeave


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        CtaDown ->
            ( { model | ctaPressed = True }, Cmd.none )

        CtaUp ->
            ( { model | ctaPressed = False }, Cmd.none )

        CtaEnter ->
            ( { model | ctaHot = True }, Cmd.none )

        CtaLeave ->
            ( { model | ctaPressed = False, ctaHot = False }, Cmd.none )



-- VIEW


playUrl : String
playUrl =
    "https://play.elyad.io/?world=1"


view : Model -> Html Msg
view model =
    main_
        [ A.class "park"
        , A.classList [ ( "reduced-motion", model.reducedMotion ) ]
        ]
        [ atmosphere
        , div [ A.class "park-stage" ]
            [ div [ A.class "park-rail park-rail-top" ]
                [ span [ A.class "park-stamp juice-stamp" ] [ text "UNCOMMITTED" ]
                , span [ A.class "park-dot" ] []
                , span [ A.class "park-mono" ] [ text "ELYAD.IO" ]
                ]
            , div [ A.class "park-hero" ]
                [ p [ A.class "park-kicker" ] [ text "A taster · Not a roadmap" ]
                , h1 [ A.class "park-name" ]
                    [ span [ A.class "park-name-main" ] [ text "elyad" ]
                    , span [ A.class "park-name-tld juice-tld" ] [ text ".io" ]
                    ]
                , div [ A.class "park-rule" ] []
                , p [ A.class "park-line" ] [ text "Things may appear here." ]
                , p [ A.class "park-sub" ]
                    [ text "A quiet address for work that might ship — games, experiments, signals. "
                    , Html.strong [] [ text "JAKESJAM" ]
                    , text " is one possible noise in the house. No promises. No timeline. Taste at your own risk."
                    ]
                , vessel
                , div [ A.class "park-hints" ]
                    [ hint "arena" "maybe"
                    , hint "draft" "maybe"
                    , hint "world" "maybe"
                    , hint "more" "unknown"
                    ]
                , div [ A.class "park-cta" ]
                    [ a
                        [ A.class "btn-enter shimmer juice-halo juice-magnet"
                        , A.classList
                            [ ( "is-pressed", model.ctaPressed )
                            , ( "is-hot", model.ctaHot )
                            ]
                        , A.href playUrl
                        , A.id "enter-cta"
                        , E.on "pointerdown" (D.succeed CtaDown)
                        , E.on "pointerup" (D.succeed CtaUp)
                        , E.on "pointerenter" (D.succeed CtaEnter)
                        , E.on "pointerleave" (D.succeed CtaLeave)
                        ]
                        [ span [ A.class "btn-enter-glow" ] []
                        , span [ A.class "btn-enter-label" ] [ text "Taste JAKESJAM" ]
                        , span [ A.class "btn-enter-url" ] [ text "play.elyad.io · if it still runs" ]
                        , span [ A.class "btn-enter-burst", A.attribute "aria-hidden" "true" ]
                            (List.map burstSpike (List.range 0 11))
                        ]
                    ]
                , p [ A.class "park-disclaimer" ]
                    [ text "What you find may change, vanish, or never have been intended." ]
                ]
            , footer [ A.class "park-rail park-rail-bot" ]
                [ span [ A.class "park-mono" ] [ text "NOT A PROMISE" ]
                , span [ A.class "park-sep" ] [ text "·" ]
                , a [ A.class "park-link juice-link", A.href playUrl ] [ text "play.elyad.io" ]
                , span [ A.class "park-sep" ] [ text "·" ]
                , span [ A.class "park-mono park-dim" ] [ text "MAY NEVER COME" ]
                ]
            ]
        ]


hint : String -> String -> Html msg
hint label status =
    div [ A.class "hint" ]
        [ span [ A.class "hint-label" ] [ text label ]
        , span [ A.class "hint-status" ] [ text status ]
        ]


burstSpike : Int -> Html msg
burstSpike i =
    span
        [ A.class "burst-i"
        , A.style "--a" (String.fromInt (i * 30) ++ "deg")
        , A.style "--d" (String.fromInt (i * 18) ++ "ms")
        ]
        []


atmosphere : Html msg
atmosphere =
    div [ A.class "atmo", A.attribute "aria-hidden" "true" ]
        [ div [ A.class "sky" ] []
        , div [ A.class "horizon" ] []
        , div [ A.class "grid" ] []
        , div [ A.class "grain" ] []
        , div [ A.class "orb orb-a" ] []
        , div [ A.class "orb orb-b" ] []
        , div [ A.class "orb orb-c" ] []
        , div [ A.class "scan" ] []
        , div [ A.class "motes" ] (List.map mote (List.range 0 17))
        ]


mote : Int -> Html msg
mote i =
    span
        [ A.class "mote"
        , A.style "--i" (String.fromInt i)
        , A.style "--x" (String.fromInt (7 + modBy 86 (i * 17)) ++ "vw")
        , A.style "--y" (String.fromInt (8 + modBy 75 (i * 23)) ++ "vh")
        , A.style "--s" (String.fromFloat (0.4 + toFloat (modBy 6 i) * 0.15))
        , A.style "--dur" (String.fromInt (8 + modBy 10 i) ++ "s")
        , A.style "--del" (String.fromInt (modBy 9 i) ++ "s")
        ]
        []


vessel : Html msg
vessel =
    div [ A.class "vessel juice-vessel", A.attribute "aria-hidden" "true", A.title "vessel" ]
        [ div [ A.class "vessel-glow" ] []
        , div [ A.class "vessel-hull" ] []
        , div [ A.class "vessel-spine" ] []
        , div [ A.class "vessel-visor" ] []
        , div [ A.class "vessel-ring" ] []
        , div [ A.class "vessel-ring vessel-ring-2" ] []
        ]



-- MAIN


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = \_ -> Sub.none
        }
