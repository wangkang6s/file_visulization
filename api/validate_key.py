import json

def handler(event, context):
    """
    Standalone serverless function for API key validation.
    This is a minimal implementation that only checks the format of the API key.
    """
    # Set CORS headers for all responses
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
        'Content-Type': 'application/json'
    }
    
    # Handle OPTIONS requests (CORS preflight)
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': ''
        }
    
    try:
        # Parse request body
        body = event.get('body', '{}')
        if not body:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'valid': False,
                    'message': 'Empty request body'
                })
            }
        
        # Parse JSON
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'valid': False,
                    'message': 'Invalid JSON in request body'
                })
            }
        
        # Get API key
        api_key = data.get('api_key', '')
        if not api_key:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'valid': False,
                    'message': 'API key is required'
                })
            }
        
        # Simple format validation
        if not api_key.startswith('sk-ant'):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'valid': False,
                    'message': 'API key format is invalid. It should start with \'sk-ant\''
                })
            }
        
        # If we get here, the key format is valid
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'valid': True,
                'message': 'API key format is valid'
            })
        }
        
    except Exception as e:
        # Catch all errors and return a proper JSON response
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'valid': False,
                'message': f'Error validating API key: {str(e)}'
            })
        } 