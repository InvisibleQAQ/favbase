import { useState, useCallback, useEffect, useRef } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Autocomplete from '@mui/material/Autocomplete';

import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Divider from '@mui/material/Divider';

import { Iconify } from '../../components/iconify';
import { LLM_PROVIDERS, type LLMProviderId, type LLMProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import type { LlmUpdate } from '@/lib/hooks/useSettings';
import { testLlmConnection, fetchAvailableModels, type TestConnectionResult } from '@/lib/ai';

interface LlmConfigCardProps {
  settings: UserSettings;
  currentProviderDef: LLMProviderDef;
  currentLlmApiKey: string;
  currentLlmModel: string;
  isCustomProvider: boolean;
  saved: boolean;
  updateLlm: (update: LlmUpdate) => void;
}

export function LlmConfigCard({
  settings,
  currentProviderDef,
  currentLlmApiKey,
  currentLlmModel,
  isCustomProvider,
  saved,
  updateLlm,
}: LlmConfigCardProps) {
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  const prevProviderRef = useRef(settings.provider);
  useEffect(() => {
    if (prevProviderRef.current !== settings.provider) {
      prevProviderRef.current = settings.provider;
      setTestResult(null);
      setTestError(null);
      setRemoteModels([]);
      setModelFetchError(null);
    }
  }, [settings.provider]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);

    try {
      const result = await testLlmConnection({
        providerId: settings.provider,
        apiKey: currentLlmApiKey,
        model: currentLlmModel,
        customBaseUrl: settings.customBaseUrl,
        customProtocol: settings.customProtocol,
      });
      setTestResult(result);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }, [settings.provider, currentLlmApiKey, currentLlmModel, settings.customBaseUrl, settings.customProtocol]);

  const handleFetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    setModelFetchError(null);

    try {
      const result = await fetchAvailableModels({
        providerId: settings.provider,
        apiKey: currentLlmApiKey,
        customBaseUrl: settings.customBaseUrl,
      });
      setRemoteModels(result.models);
    } catch (err) {
      setModelFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings.provider, currentLlmApiKey, settings.customBaseUrl]);

  const canTest = !!(currentLlmApiKey && currentLlmModel);

  return (
    <Card>
      <CardHeader
        title="LLM 服务配置"
        subheader="配置大语言模型服务以实现视频内容总结"
      />
      <CardContent>
        <Grid container spacing={3}>
          {/* Provider */}
          <Grid size={{ xs: 12 }}>
            <TextField
              select
              fullWidth
              label="LLM 服务商"
              value={settings.provider}
              onChange={(e) => updateLlm({ field: 'provider', value: e.target.value as LLMProviderId })}
            >
              {LLM_PROVIDERS.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {/* Base URL */}
          <Grid size={{ xs: 12, md: isCustomProvider ? 6 : 12 }}>
            <TextField
              fullWidth
              label="Base URL"
              placeholder="https://your-endpoint.com/v1/"
              value={isCustomProvider ? settings.customBaseUrl : currentProviderDef.baseUrl}
              onChange={isCustomProvider ? (e) => updateLlm({ field: 'customBaseUrl', value: e.target.value }) : undefined}
              slotProps={{
                input: { readOnly: !isCustomProvider },
              }}
              sx={!isCustomProvider ? (theme) => ({ '& .MuiInputBase-input': { color: theme.vars.palette.text.secondary } }) : undefined}
            />
          </Grid>

          {isCustomProvider && (
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                select
                fullWidth
                label="协议"
                value={settings.customProtocol}
                onChange={(e) => updateLlm({ field: 'customProtocol', value: e.target.value as 'openai' | 'claude' })}
              >
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="claude">Claude</MenuItem>
              </TextField>
            </Grid>
          )}

          {/* API Key */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="API Key"
              type={showKey ? 'text' : 'password'}
              placeholder="sk-..."
              value={currentLlmApiKey}
              onChange={(e) => updateLlm({ field: 'apiKey', value: e.target.value })}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={() => setShowKey((v) => !v)}
                        size="small"
                      >
                        <Iconify
                          icon={showKey ? 'solar:eye-bold' : 'solar:eye-closed-bold'}
                          width={20}
                        />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {currentProviderDef.regUrl && (
                <Button
                  variant="outlined"
                  size="small"
                  href={currentProviderDef.regUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
                >
                  获取密钥
                </Button>
              )}
            </Box>
          </Grid>

          {/* Model with Autocomplete */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Autocomplete
              freeSolo
              options={remoteModels}
              value={currentLlmModel}
              onInputChange={(_e, value) => updateLlm({ field: 'model', value })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="模型"
                  placeholder={currentProviderDef.defaultModel || '输入模型名称'}
                />
              )}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Button
              variant="outlined"
              onClick={handleFetchModels}
              disabled={isFetchingModels || !currentLlmApiKey}
              startIcon={isFetchingModels ? <CircularProgress size={16} /> : undefined}
              sx={{ height: 56 }}
            >
              {isFetchingModels ? '获取中...' : '获取模型列表'}
            </Button>
          </Grid>

          {remoteModels.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                已获取 {remoteModels.length} 个可用模型
              </Typography>
            </Grid>
          )}

          {modelFetchError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error" variant="outlined">
                获取模型列表失败：{modelFetchError}
              </Alert>
            </Grid>
          )}

          {/* Test Connection + Saved indicator */}
          <Grid size={{ xs: 12 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                variant="contained"
                onClick={handleTestConnection}
                disabled={isTesting || !canTest}
                startIcon={isTesting ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {isTesting ? '测试中...' : '测试连接'}
              </Button>
              {saved && (
                <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
                  已保存
                </Typography>
              )}
            </Box>
          </Grid>

          {testResult && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Iconify icon="solar:check-circle-bold" width={22} />}
              >
                连接成功 — {testResult.message}
              </Alert>
            </Grid>
          )}

          {testError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                连接失败 — {testError}
              </Alert>
            </Grid>
          )}

          {/* Advanced Settings */}
          <Grid size={{ xs: 12 }}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" sx={{ mt: 2, mb: 1, fontWeight: 600 }}>
              高级设置
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="Temperature"
              type="number"
              value={settings.temperature}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0 && v <= 2) updateLlm({ field: 'temperature', value: v });
              }}
              helperText="控制生成内容的随机性（0-2，推荐 0.3）"
              slotProps={{
                htmlInput: { step: 0.1, min: 0, max: 2 },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="最大 Token 数"
              type="number"
              value={settings.maxTokens}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) updateLlm({ field: 'maxTokens', value: v });
              }}
              helperText="单次请求最大生成 token 数量"
              slotProps={{
                htmlInput: { min: 1, step: 100 },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                调用模式
              </Typography>
              <ToggleButtonGroup
                exclusive
                value={settings.prefMode}
                onChange={(_e, val) => { if (val) updateLlm({ field: 'prefMode', value: val }); }}
                sx={{ gap: 1 }}
              >
                <ToggleButton value="quality" sx={{ px: 3 }}>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle2">质量优先</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      两次独立请求并行，结果更准确
                    </Typography>
                  </Box>
                </ToggleButton>
                <ToggleButton value="efficiency" sx={{ px: 3 }}>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle2">效率优先</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      单次请求合并，速度更快
                    </Typography>
                  </Box>
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
