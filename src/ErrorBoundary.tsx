import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Captura erros de renderização em qualquer ponto da árvore de componentes.
 *
 * Sem isto, um único erro não tratado durante o render desmonta a aplicação
 * inteira e o usuário fica olhando para uma tela branca, sem mensagem e sem
 * saída. Como o RevisAuto é um componente único e grande, o risco de um campo
 * inesperado vindo da API derrubar tudo é real.
 */

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Em produção, este é o ponto natural para enviar a um serviço de
    // monitoramento (Sentry, Cloudflare Analytics, etc).
    console.error('Erro não tratado na interface:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    // Último recurso: limpa o estado local e recomeça do login.
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-[#181a1c] text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="text-5xl mb-4" aria-hidden="true">
            🔧
          </div>
          <h1 className="text-xl font-bold mb-2">Algo deu errado</h1>
          <p className="text-gray-400 text-sm mb-6">
            A tela travou por um erro inesperado. Seus dados estão salvos — nada
            foi perdido.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={this.handleReload}
              className="w-full bg-teal-500 hover:bg-teal-400 text-black font-semibold py-3 rounded-xl transition-colors"
            >
              Recarregar a página
            </button>
            <button
              onClick={this.handleReset}
              className="w-full border border-gray-700 hover:border-gray-500 text-gray-300 py-3 rounded-xl transition-colors"
            >
              Sair e entrar de novo
            </button>
          </div>

          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-6 text-left text-xs text-red-400 bg-black/40 p-3 rounded-lg overflow-auto max-h-48">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
