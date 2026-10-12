import React from 'react';
import AIResultView from './AIResultView';

export default function AIResultDisplay({ result, loading, model }) {
  return <AIResultView response={result} loading={loading} model={model} title="AI Analysis Result" />;
}
