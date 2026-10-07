from users.locale import resolve_locale


def locale_context(request):
    return {'ui_locale': getattr(request, 'locale_state', None) or resolve_locale(request)}
