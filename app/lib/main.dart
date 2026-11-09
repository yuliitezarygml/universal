import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'src/iskra_api.dart';

void main() {
  const configuredUrl = String.fromEnvironment('ISKRA_API_URL');
  final url = configuredUrl.isEmpty && kDebugMode
      ? (Platform.isAndroid ? 'http://10.0.2.2:8080' : 'http://localhost:8080')
      : configuredUrl;
  final base = Uri.tryParse(url);
  final api =
      base != null &&
          base.host.isNotEmpty &&
          (base.scheme == 'https' || (kDebugMode && base.scheme == 'http'))
      ? IskraApi(base)
      : null;
  runApp(IskraApp(api: api));
}

class IskraApp extends StatelessWidget {
  const IskraApp({required this.api, super.key});

  final IskraApi? api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Искра',
      theme: ThemeData(colorSchemeSeed: const Color(0xff7451af)),
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xff7451af),
      ),
      home: _StartScreen(api: api),
    );
  }
}

class _StartScreen extends StatefulWidget {
  const _StartScreen({required this.api});

  final IskraApi? api;

  @override
  State<_StartScreen> createState() => _StartScreenState();
}

class _StartScreenState extends State<_StartScreen> {
  final _token = TextEditingController();
  final _prompt = TextEditingController();
  StreamSubscription<String>? _subscription;
  String _status = 'Проверка подключения';
  String _answer = '';

  @override
  void initState() {
    super.initState();
    unawaited(_checkServer());
  }

  Future<void> _checkServer() async {
    final api = widget.api;
    final status = api == null
        ? 'Адрес сервера не настроен'
        : await api.ready()
        ? 'Сервер подключён'
        : 'Сервер недоступен';
    if (mounted) setState(() => _status = status);
  }

  void _send() {
    final api = widget.api;
    final text = _prompt.text.trim();
    final token = _token.text.trim();
    if (api == null || _subscription != null || text.isEmpty || token.isEmpty) {
      return;
    }
    setState(() {
      _answer = '';
      _subscription = api
          .streamChat(token: token, text: text)
          .listen(
            (delta) => setState(() => _answer += delta),
            onDone: () => setState(() => _subscription = null),
            onError: (Object error) => setState(() {
              final code = error is IskraApiException
                  ? error.code
                  : 'network_error';
              _answer += '\nОшибка: $code';
              _subscription = null;
            }),
            cancelOnError: true,
          );
    });
  }

  void _stop() {
    unawaited(_subscription?.cancel());
    setState(() => _subscription = null);
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    _token.dispose();
    _prompt.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Искра')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(_status, style: Theme.of(context).textTheme.titleMedium),
          TextButton(
            onPressed: _checkServer,
            child: const Text('Проверить подключение'),
          ),
          if (kDebugMode && widget.api != null) ...[
            const SizedBox(height: 16),
            TextField(
              controller: _token,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(
                labelText: 'Тестовый токен «Искры»',
              ),
            ),
            TextField(
              controller: _prompt,
              minLines: 1,
              maxLines: 4,
              decoration: const InputDecoration(labelText: 'Сообщение'),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _subscription == null ? _send : _stop,
              child: Text(_subscription == null ? 'Отправить' : 'Стоп'),
            ),
            const SizedBox(height: 16),
            SelectableText(_answer),
          ],
        ],
      ),
    );
  }
}
