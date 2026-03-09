import { TTSConfig, TTSConfigValidator } from "../store";

import Locale from "../locales";
import { ListItem, Select } from "./ui-lib";
import {
  DEFAULT_EDGE_TTS_VOICE,
  DEFAULT_TTS_ENGINE,
  DEFAULT_TTS_ENGINES,
  DEFAULT_TTS_MODELS,
  DEFAULT_TTS_VOICE,
  DEFAULT_TTS_VOICES,
  EDGE_TTS_VOICES,
} from "../constant";
import { InputRange } from "./input-range";

export function TTSConfigList(props: {
  ttsConfig: TTSConfig;
  updateConfig: (updater: (config: TTSConfig) => void) => void;
}) {
  const isOpenAITTS = props.ttsConfig.engine === DEFAULT_TTS_ENGINE;
  const voiceOptions = isOpenAITTS ? DEFAULT_TTS_VOICES : EDGE_TTS_VOICES;

  return (
    <>
      <ListItem
        title={Locale.Settings.TTS.Enable.Title}
        subTitle={Locale.Settings.TTS.Enable.SubTitle}
      >
        <input
          type="checkbox"
          checked={props.ttsConfig.enable}
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.enable = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem>
      {/* <ListItem
        title={Locale.Settings.TTS.Autoplay.Title}
        subTitle={Locale.Settings.TTS.Autoplay.SubTitle}
      >
        <input
          type="checkbox"
          checked={props.ttsConfig.autoplay}
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.autoplay = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem> */}
      <ListItem title={Locale.Settings.TTS.Engine}>
        <Select
          value={props.ttsConfig.engine}
          onChange={(e) => {
            const nextEngine = TTSConfigValidator.engine(
              e.currentTarget.value,
            );
            props.updateConfig(
              (config) => {
                const nextVoiceOptions =
                  nextEngine === DEFAULT_TTS_ENGINE
                    ? DEFAULT_TTS_VOICES
                    : EDGE_TTS_VOICES;

                config.engine = nextEngine;

                if (!nextVoiceOptions.includes(config.voice as any)) {
                  config.voice = TTSConfigValidator.voice(
                    nextEngine === DEFAULT_TTS_ENGINE
                      ? DEFAULT_TTS_VOICE
                      : DEFAULT_EDGE_TTS_VOICE,
                  );
                }
              },
            );
          }}
        >
          {DEFAULT_TTS_ENGINES.map((v, i) => (
            <option value={v} key={i}>
              {v}
            </option>
          ))}
        </Select>
      </ListItem>
      {isOpenAITTS && (
        <ListItem title={Locale.Settings.TTS.Model}>
          <Select
            value={props.ttsConfig.model}
            onChange={(e) => {
              props.updateConfig(
                (config) =>
                  (config.model = TTSConfigValidator.model(
                    e.currentTarget.value,
                  )),
              );
            }}
          >
            {DEFAULT_TTS_MODELS.map((v, i) => (
              <option value={v} key={i}>
                {v}
              </option>
            ))}
          </Select>
        </ListItem>
      )}
      <ListItem
        title={Locale.Settings.TTS.Voice.Title}
        subTitle={Locale.Settings.TTS.Voice.SubTitle}
      >
        <Select
          value={props.ttsConfig.voice}
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.voice = TTSConfigValidator.voice(
                  e.currentTarget.value,
                )),
            );
          }}
        >
          {voiceOptions.map((v, i) => (
            <option value={v} key={i}>
              {v}
            </option>
          ))}
        </Select>
      </ListItem>
      <ListItem
        title={Locale.Settings.TTS.Speed.Title}
        subTitle={Locale.Settings.TTS.Speed.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.TTS.Speed.Title}
          value={props.ttsConfig.speed?.toFixed(1)}
          min="0.3"
          max="4.0"
          step="0.1"
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.speed = TTSConfigValidator.speed(
                  e.currentTarget.valueAsNumber,
                )),
            );
          }}
        ></InputRange>
      </ListItem>
    </>
  );
}
