from unittest.mock import patch

from django.test import TestCase


class LocaleTemplateTests(TestCase):
    def test_login_and_signup_both_template_variants_render_chinese(self):
        for new_ui in (False, True):
            with self.subTest(new_ui=new_ui), patch('users.views.flag_set', return_value=new_ui):
                for path in ('/user/login/', '/user/signup/'):
                    response = self.client.get(path, HTTP_ACCEPT_LANGUAGE='zh-CN')
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response['Content-Language'], 'zh-CN')
                    self.assertContains(response, 'data-testid="anonymous-language-select"')
                    self.assertContains(response, '界面语言')
                    self.assertContains(response, 'name="csrfmiddlewaretoken"')
                    self.assertContains(response, '<html lang="zh-CN"')

    def test_english_template_does_not_translate_input_values(self):
        with patch('users.views.flag_set', return_value=True):
            response = self.client.get('/user/signup/', HTTP_ACCEPT_LANGUAGE='en-US')
        self.assertContains(response, 'Display language')
        self.assertContains(response, 'value="en-US"')
        self.assertContains(response, 'value="zh-CN"')
        self.assertContains(response, 'data-locale-en=')
        self.assertContains(response, 'data-locale-zh=')
